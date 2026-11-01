"""OpenStreetMap via the Overpass API: the park boundary and the ways inside it.

The snapshot keeps every ``highway=*`` way in the park with a few useful tags. Whether a way is
walkable for visitors is decided later (:func:`is_walkable`), so the rules can change without
refetching. OSM data is © OpenStreetMap contributors, licensed under the ODbL.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping, shape
from shapely.ops import polygonize, unary_union

from inhotim_path.geo import LatLng
from inhotim_path.sources import SourceError

OVERPASS_ENDPOINTS: tuple[str, ...] = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
#: "Centro de Arte Contemporânea Inhotim" (leisure=park). Not 5418785, the private nature reserve.
PARK_RELATION_ID = 5418784
LICENSE = "ODbL 1.0, © OpenStreetMap contributors"

WALKABLE_HIGHWAYS = frozenset(
    {"footway", "path", "pedestrian", "steps", "living_street", "service", "track", "cycleway"}
)
KEPT_TAGS = ("name", "access", "foot", "surface", "smoothness", "tracktype", "bridge", "service")
_RETRYABLE_STATUS = frozenset({429, 502, 503, 504})


def park_query(relation_id: int = PARK_RELATION_ID) -> str:
    return (
        "[out:json][timeout:90];"
        f"rel({relation_id})->.park;"
        ".park out geom;"
        ".park map_to_area->.a;"
        'way["highway"](area.a);'
        "out tags geom;"
    )


@dataclass(frozen=True)
class OsmWay:
    id: int
    highway: str
    coords: tuple[LatLng, ...]
    tags: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class OsmPark:
    relation_id: int
    boundary: Polygon | MultiPolygon
    """Park area in (lng, lat) coordinates, like GeoJSON."""
    ways: tuple[OsmWay, ...]


def is_walkable(way: OsmWay) -> bool:
    """Visitor-walkable: a path-like highway, not closed to the public (unless foot=yes)."""
    if way.highway not in WALKABLE_HIGHWAYS:
        return False
    if way.tags.get("foot") in {"yes", "designated", "permissive"}:
        return True
    return way.tags.get("access") not in {"private", "no"} and way.tags.get("foot") != "no"


# --------------------------------------------------------------------------- network


def fetch_overpass(
    client: httpx.Client,
    query: str,
    *,
    endpoints: Sequence[str] = OVERPASS_ENDPOINTS,
    rounds: int = 3,
    backoff_s: float = 10.0,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """POST a query, rotating through endpoints with exponential backoff between rounds.

    Public Overpass servers are often at capacity (HTTP 429/502/504) or time out, so a single
    request is not enough.
    """
    errors: list[str] = []
    for round_index in range(rounds):
        for endpoint in endpoints:
            try:
                response = client.post(endpoint, data={"data": query}, timeout=120.0)
            except httpx.TransportError as exc:
                errors.append(f"{endpoint}: {type(exc).__name__}")
                continue
            if response.status_code in _RETRYABLE_STATUS:
                errors.append(f"{endpoint}: HTTP {response.status_code}")
                continue
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError:
                errors.append(f"{endpoint}: non-JSON response")
                continue
            if "error" in str(payload.get("remark", "")).lower():
                errors.append(f"{endpoint}: {payload['remark']}")
                continue
            return payload
        if round_index < rounds - 1:
            sleep(backoff_s * 2**round_index)
    raise SourceError("Overpass: every endpoint failed: " + "; ".join(errors[-len(endpoints) :]))


def fetch_park(client: httpx.Client, relation_id: int = PARK_RELATION_ID, **kwargs: Any) -> OsmPark:
    return parse_park(fetch_overpass(client, park_query(relation_id), **kwargs), relation_id)


# --------------------------------------------------------------------------- parsing


def parse_park(payload: Mapping[str, Any], relation_id: int = PARK_RELATION_ID) -> OsmPark:
    elements = payload.get("elements")
    if not isinstance(elements, list):
        raise SourceError("Overpass: response has no 'elements'")
    relation = next(
        (e for e in elements if e.get("type") == "relation" and e.get("id") == relation_id), None
    )
    if relation is None:
        raise SourceError(f"Overpass: park relation {relation_id} not in the response")
    ways = tuple(
        sorted(
            (way for e in elements if e.get("type") == "way" and (way := _parse_way(e))),
            key=lambda w: w.id,
        )
    )
    return OsmPark(relation_id=relation_id, boundary=_assemble_boundary(relation), ways=ways)


def to_snapshot(park: OsmPark, *, fetched_at: str) -> dict[str, Any]:
    return {
        "source": "OpenStreetMap via the Overpass API",
        "license": LICENSE,
        "fetched_at": fetched_at,
        "park_relation": park.relation_id,
        "boundary": _jsonable(mapping(park.boundary)),
        "ways": [
            {
                "id": way.id,
                "highway": way.highway,
                "tags": dict(way.tags),
                "coords": [[round(lng, 7), round(lat, 7)] for lat, lng in way.coords],
            }
            for way in park.ways
        ],
    }


def from_snapshot(data: Mapping[str, Any]) -> OsmPark:
    return OsmPark(
        relation_id=int(data["park_relation"]),
        boundary=shape(data["boundary"]),
        ways=tuple(
            OsmWay(
                id=int(w["id"]),
                highway=w["highway"],
                coords=tuple((lat, lng) for lng, lat in w["coords"]),
                tags=dict(w.get("tags", {})),
            )
            for w in data["ways"]
        ),
    )


# --------------------------------------------------------------------------- helpers


def _parse_way(element: Mapping[str, Any]) -> OsmWay | None:
    tags = element.get("tags") or {}
    geometry = element.get("geometry") or []
    if "highway" not in tags or len(geometry) < 2:
        return None
    return OsmWay(
        id=int(element["id"]),
        highway=str(tags["highway"]),
        coords=tuple((float(p["lat"]), float(p["lon"])) for p in geometry),
        tags={k: str(tags[k]) for k in KEPT_TAGS if k in tags},
    )


def _assemble_boundary(relation: Mapping[str, Any]) -> Polygon | MultiPolygon:
    """Build the multipolygon from its member ways (which may be split into several pieces)."""

    def rings(role: str) -> list[LineString]:
        return [
            LineString([(p["lon"], p["lat"]) for p in member["geometry"]])
            for member in relation.get("members", [])
            if member.get("type") == "way"
            and (member.get("role") or "outer") == role
            and len(member.get("geometry") or []) >= 2
        ]

    area = unary_union(list(polygonize(rings("outer"))))
    holes = list(polygonize(rings("inner")))
    if holes:
        area = area.difference(unary_union(holes))
    if area.is_empty or not isinstance(area, Polygon | MultiPolygon):
        raise SourceError("Overpass: could not assemble the park boundary polygon")
    return area


def _jsonable(value: Any) -> Any:
    """Tuples -> lists, so snapshots compare equal after a JSON round trip."""
    if isinstance(value, tuple | list):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return value

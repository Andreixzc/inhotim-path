"""From data snapshots and a visitor's request to a timed itinerary.

This is the glue between the pieces: pick the stops, build the walking graph, compute the
walking-time matrix, solve, and lay the result out on a timeline.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from inhotim_path import snapshots
from inhotim_path.geo import LatLng
from inhotim_path.matrix import walking_matrix
from inhotim_path.models import Poi, PoiKind
from inhotim_path.network import NetworkConfig, build_network
from inhotim_path.solver import Stop, solve
from inhotim_path.sources import axes as axes_source
from inhotim_path.sources import osm as osm_source
from inhotim_path.sources.axes import AxisLine
from inhotim_path.sources.osm import OsmPark

DEFAULT_KINDS = (PoiKind.GALLERY, PoiKind.OUTDOOR_WORK, PoiKind.GARDEN)
DEFAULT_START = "Recepção"
DEFAULT_SPEED_KMH = 4.0
#: Minutes spent at each kind of stop. Assumptions, to be refined (see docs/vision.md).
#: When a time budget forces choices, a stop is worth its minutes: the route maximizes the time
#: spent with art, then minimizes walking. Raising a kind's minutes also makes it more attractive.
DEFAULT_DWELL_MIN: Mapping[PoiKind, float] = {
    PoiKind.GALLERY: 20,
    PoiKind.OUTDOOR_WORK: 8,
    PoiKind.GARDEN: 10,
    PoiKind.BOTANICAL: 3,
    PoiKind.EXHIBITION: 20,
    PoiKind.WORK_IN_GALLERY: 5,
    PoiKind.OTHER: 5,
    PoiKind.SERVICE: 0,
    PoiKind.EVENT: 0,
}


class PlanningError(ValueError):
    """A request that can't be planned (unknown name, ambiguous start, ...)."""


@dataclass(frozen=True)
class ParkData:
    pois: tuple[Poi, ...]
    park: OsmPark
    axes: tuple[AxisLine, ...]

    @classmethod
    def load(cls, data_dir: Path) -> ParkData:
        try:
            return cls(
                pois=tuple(snapshots.read_pois(data_dir / snapshots.POIS_FILE)),
                park=osm_source.from_snapshot(snapshots.read_json(data_dir / snapshots.OSM_FILE)),
                axes=tuple(
                    axes_source.from_feature_collection(
                        snapshots.read_json(data_dir / snapshots.AXES_FILE)
                    )
                ),
            )
        except FileNotFoundError as exc:
            raise PlanningError(
                f"missing snapshot {exc.filename}: run 'inhotim-path fetch'"
            ) from exc


@dataclass(frozen=True)
class PlanRequest:
    kinds: tuple[PoiKind, ...] = DEFAULT_KINDS
    must: tuple[str, ...] = ()
    """Name/artist queries that must be visited (accent- and case-insensitive)."""
    exclude: tuple[str, ...] = ()
    start: str = DEFAULT_START
    budget_min: float | None = None
    speed_kmh: float = DEFAULT_SPEED_KMH
    dwell_min: Mapping[PoiKind, float] = field(default_factory=lambda: dict(DEFAULT_DWELL_MIN))
    time_limit_s: float = 5.0
    network: NetworkConfig = field(default_factory=NetworkConfig)


@dataclass(frozen=True)
class Visit:
    poi: Poi
    arrive_s: int
    """Seconds since the start of the visit."""
    dwell_s: int
    walk_m: float
    """Walking distance from the previous visit."""
    walk_s: int


@dataclass(frozen=True)
class Plan:
    request: PlanRequest
    visits: tuple[Visit, ...]
    """Start, stops in order, and back to the start."""
    legs: tuple[tuple[LatLng, ...], ...]
    """``legs[i]``: walking polyline from ``visits[i]`` to ``visits[i + 1]``."""
    skipped: tuple[Poi, ...]
    """Stops left out because of the time budget."""
    unreachable: tuple[Poi, ...]
    """Stops too far from any known path."""
    network_stats: Mapping[str, float]
    optimal: bool = False
    """The solver proved that no better route exists for this request."""

    @property
    def stops(self) -> tuple[Visit, ...]:
        return self.visits[1:-1]

    @property
    def walk_m(self) -> float:
        return sum(v.walk_m for v in self.visits)

    @property
    def walk_s(self) -> int:
        return sum(v.walk_s for v in self.visits)

    @property
    def dwell_s(self) -> int:
        return sum(v.dwell_s for v in self.visits)

    @property
    def total_s(self) -> int:
        return self.walk_s + self.dwell_s


def plan_route(data: ParkData, request: PlanRequest) -> Plan:
    start = find_start(data.pois, request.start)
    must_ids = set()
    for query in request.must:
        found = search(data.pois, query)
        if not found:
            raise PlanningError(f"--must {query!r} doesn't match anything on the map")
        must_ids.update(p.id for p in found)
    excluded = {p.id for query in request.exclude for p in search(data.pois, query)}
    candidates = [
        p
        for p in data.pois
        if ((p.main_view and p.kind in request.kinds) or p.id in must_ids)
        and p.id not in excluded
        and p.id != start.id
    ]
    if not candidates:
        raise PlanningError("no stops selected: check --kinds / --exclude")

    network = build_network(data.park, data.axes, [start, *candidates], request.network)
    if start.id not in network.poi_nodes:
        raise PlanningError(f"the start {start.name!r} is too far from any path")
    reachable = [p for p in candidates if p.id in network.poi_nodes]
    unreachable = tuple(p for p in candidates if p.id not in network.poi_nodes)

    matrix = walking_matrix(network, [start.id, *(p.id for p in reachable)])
    speed_mps = request.speed_kmh / 3.6
    stops = [
        Stop(
            poi_id=p.id,
            dwell_s=_dwell_s(p, request),
            value=max(1, round(_dwell_s(p, request) / 60)),
            mandatory=p.id in must_ids,
        )
        for p in reachable
    ]
    budget_s = round(request.budget_min * 60) if request.budget_min is not None else None
    route = solve(
        start.id,
        stops,
        matrix,
        speed_mps=speed_mps,
        budget_s=budget_s,
        time_limit_s=request.time_limit_s,
    )

    by_id = {p.id: p for p in [start, *reachable]}
    visits: list[Visit] = []
    legs: list[tuple[LatLng, ...]] = []
    for position, poi_id in enumerate(route.order):
        poi = by_id[poi_id]
        is_endpoint = position in (0, len(route.order) - 1)
        if not visits:
            visits.append(Visit(poi=poi, arrive_s=0, dwell_s=0, walk_m=0.0, walk_s=0))
            continue
        previous = visits[-1]
        walk_m = matrix.distance(previous.poi.id, poi_id)
        walk_s = round(walk_m / speed_mps)
        visits.append(
            Visit(
                poi=poi,
                arrive_s=previous.arrive_s + previous.dwell_s + walk_s,
                dwell_s=0 if is_endpoint else _dwell_s(poi, request),
                walk_m=walk_m,
                walk_s=walk_s,
            )
        )
        legs.append(tuple(network.path_latlngs(matrix.path(previous.poi.id, poi_id))))

    return Plan(
        request=request,
        visits=tuple(visits),
        legs=tuple(legs),
        skipped=tuple(by_id[i] for i in route.skipped),
        unreachable=unreachable,
        network_stats=network.stats,
        optimal=route.optimal,
    )


# --------------------------------------------------------------------------- name search


def normalize(text: str) -> str:
    """Accent- and case-insensitive form: "Galeria Praça" -> "galeria praca"."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold().strip()


def search(pois: Sequence[Poi], query: str) -> list[Poi]:
    """POIs whose name or artist contains the query."""
    needle = normalize(query)
    return [
        p
        for p in pois
        if needle
        and (needle in normalize(p.name) or any(needle in normalize(a) for a in p.artists))
    ]


def find_start(pois: Sequence[Poi], query: str) -> Poi:
    found = search(pois, query)
    exact = [p for p in found if normalize(p.name) == normalize(query)]
    if len(exact) == 1:
        return exact[0]
    if len(found) == 1:
        return found[0]
    if not found:
        raise PlanningError(f"no start point matches {query!r}")
    names = ", ".join(sorted({p.name for p in found})[:8])
    raise PlanningError(f"start {query!r} is ambiguous: {names}")


def display_name(poi: Poi) -> str:
    """Name with the artist when the title alone is ambiguous ("sem título")."""
    if poi.artists and normalize(poi.name).startswith(("sem titulo", "untitled")):
        return f"{poi.name} ({', '.join(poi.artists)})"
    return poi.name


def _dwell_s(poi: Poi, request: PlanRequest) -> int:
    return round(request.dwell_min.get(poi.kind, DEFAULT_DWELL_MIN.get(poi.kind, 0)) * 60)

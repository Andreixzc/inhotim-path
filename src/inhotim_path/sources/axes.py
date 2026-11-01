"""Official walking routes ("eixos"): the SVG overlay of the website map, georeferenced.

The SVG is drawn for an overlay whose geographic bounds are hardcoded in the theme's JS bundle
(see :func:`inhotim_path.sources.inhotim.fetch_map_assets`). Each ``<path>`` becomes one or more
polylines in lat/lng, tagged with its route color.
"""

from __future__ import annotations

import io
import itertools
import math
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from svgelements import (
    SVG,
    Arc,
    Close,
    CubicBezier,
    Group,
    Line,
    Move,
    Path,
    QuadraticBezier,
    Shape,
)

from inhotim_path.geo import LatLng, SvgGeoreference, haversine_m
from inhotim_path.sources import SourceError

AXIS_GROUPS = ("laranja", "amarelo", "rosa")


@dataclass(frozen=True)
class AxisLine:
    axis: str | None
    """Route color ("laranja", "amarelo", "rosa"), or None for paths outside those groups."""
    coords: tuple[LatLng, ...]

    @property
    def length_m(self) -> float:
        return sum(haversine_m(a, b) for a, b in itertools.pairwise(self.coords))


def parse_axes_svg(
    svg_text: str, sw: LatLng, ne: LatLng, *, step: float = 2.0
) -> tuple[list[AxisLine], SvgGeoreference]:
    """Georeference every path of the routes SVG.

    ``step`` is the curve sampling distance in SVG units (~1 m each for the official SVG);
    straight segments keep their exact endpoints.
    """
    svg = SVG.parse(io.StringIO(svg_text), reify=True)  # reify: bake transforms into coords
    if svg.viewbox is None:
        raise SourceError("axes SVG has no viewBox")
    vb = svg.viewbox
    georef = SvgGeoreference(sw=sw, ne=ne, viewbox=(vb.x, vb.y, vb.width, vb.height))
    lines: list[AxisLine] = []
    for axis, path in _paths_with_axis(svg, None):
        for polyline in _polylines(path, step):
            coords = tuple(georef.to_latlng(x, y) for x, y in polyline)
            if len(coords) >= 2:
                lines.append(AxisLine(axis=axis, coords=coords))
    if not lines:
        raise SourceError("axes SVG contains no paths")
    return lines, georef


def to_feature_collection(lines: list[AxisLine], *, source: str) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "source": source,
        "features": [
            {
                "type": "Feature",
                "properties": {"axis": line.axis},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(lng, 7), round(lat, 7)] for lat, lng in line.coords],
                },
            }
            for line in lines
        ],
    }


def from_feature_collection(data: dict[str, Any]) -> list[AxisLine]:
    return [
        AxisLine(
            axis=feature["properties"].get("axis"),
            coords=tuple((lat, lng) for lng, lat in feature["geometry"]["coordinates"]),
        )
        for feature in data["features"]
    ]


# --------------------------------------------------------------------------- helpers


def _paths_with_axis(node: Group, axis: str | None) -> Iterator[tuple[str | None, Path]]:
    for child in node:
        if isinstance(child, Group):
            group_id = child.values.get("id")
            yield from _paths_with_axis(child, group_id if group_id in AXIS_GROUPS else axis)
        elif isinstance(child, Shape):
            yield axis, child if isinstance(child, Path) else Path(child)


def _polylines(path: Path, step: float) -> Iterator[list[tuple[float, float]]]:
    current: list[tuple[float, float]] = []
    for seg in path:
        if isinstance(seg, Move):
            if len(current) >= 2:
                yield current
            current = [(seg.end.x, seg.end.y)]
        elif isinstance(seg, Close | Line):
            end = (seg.end.x, seg.end.y)
            if not current or end != current[-1]:
                current.append(end)
        elif isinstance(seg, CubicBezier | QuadraticBezier | Arc):
            n = max(1, math.ceil(seg.length() / step))
            for i in range(1, n + 1):
                p = seg.point(i / n)
                current.append((p.x, p.y))
    if len(current) >= 2:
        yield current

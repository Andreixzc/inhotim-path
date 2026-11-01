"""Geodesy helpers: distances, a local metric projection and Web Mercator SVG georeferencing.

Coordinates are ``(lat, lng)`` tuples in degrees unless stated otherwise. GeoJSON output flips
them to ``[lng, lat]``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

LatLng = tuple[float, float]

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(a: LatLng, b: LatLng) -> float:
    """Great-circle distance in meters."""
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


@dataclass(frozen=True)
class LocalProjection:
    """Equirectangular projection to meters around a reference point.

    Keeps geometry code in simple Euclidean meters. Over a park a couple of kilometers wide it
    agrees with :func:`haversine_m` to well under 0.1% (same spherical Earth). The ~0.3% gap to
    the WGS84 ellipsoid is irrelevant next to how much walking speeds vary.
    """

    lat0: float
    lng0: float
    m_per_deg_lat: float = field(init=False)
    m_per_deg_lng: float = field(init=False)

    def __post_init__(self) -> None:
        m_per_deg = math.pi * EARTH_RADIUS_M / 180.0
        object.__setattr__(self, "m_per_deg_lat", m_per_deg)
        object.__setattr__(self, "m_per_deg_lng", m_per_deg * math.cos(math.radians(self.lat0)))

    def to_xy(self, lat: float, lng: float) -> tuple[float, float]:
        return (lng - self.lng0) * self.m_per_deg_lng, (lat - self.lat0) * self.m_per_deg_lat

    def to_latlng(self, x: float, y: float) -> LatLng:
        return self.lat0 + y / self.m_per_deg_lat, self.lng0 + x / self.m_per_deg_lng


# --------------------------------------------------------------------------- Web Mercator
# Normalized world coordinates in [0, 1]; Y grows southward (like screen pixels).


def mercator_x(lng: float) -> float:
    return (lng + 180.0) / 360.0


def mercator_y(lat: float) -> float:
    phi = math.radians(lat)
    return (1.0 - math.log(math.tan(phi) + 1.0 / math.cos(phi)) / math.pi) / 2.0


def inverse_mercator(x: float, y: float) -> LatLng:
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y))))
    return lat, x * 360.0 - 180.0


@dataclass(frozen=True)
class SvgGeoreference:
    """Maps SVG user units to lat/lng for an image overlay stretched over ``LatLngBounds``.

    Reproduces what the browser does on the official map: the overlay ``<div>`` spans the bounds
    in Web Mercator pixel space, the ``<img>`` fills it at 100%, and the SVG viewBox is fitted
    inside with the default ``preserveAspectRatio="xMidYMid meet"`` (uniform scale, centered).
    """

    sw: LatLng
    ne: LatLng
    viewbox: tuple[float, float, float, float]  # min_x, min_y, width, height

    @property
    def _frame(self) -> tuple[float, float, float, float, float]:
        _, _, vb_w, vb_h = self.viewbox
        left, top = mercator_x(self.sw[1]), mercator_y(self.ne[0])
        width = mercator_x(self.ne[1]) - left
        height = mercator_y(self.sw[0]) - top
        scale = min(width / vb_w, height / vb_h)
        offset_x = left + (width - vb_w * scale) / 2
        offset_y = top + (height - vb_h * scale) / 2
        return scale, offset_x, offset_y, width, height

    def to_latlng(self, x: float, y: float) -> LatLng:
        scale, offset_x, offset_y, _, _ = self._frame
        min_x, min_y, _, _ = self.viewbox
        return inverse_mercator(offset_x + (x - min_x) * scale, offset_y + (y - min_y) * scale)

    def to_svg(self, lat: float, lng: float) -> tuple[float, float]:
        scale, offset_x, offset_y, _, _ = self._frame
        min_x, min_y, _, _ = self.viewbox
        return (
            min_x + (mercator_x(lng) - offset_x) / scale,
            min_y + (mercator_y(lat) - offset_y) / scale,
        )

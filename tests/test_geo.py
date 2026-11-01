import math

import pytest

from inhotim_path.geo import (
    LocalProjection,
    SvgGeoreference,
    haversine_m,
    inverse_mercator,
    mercator_x,
    mercator_y,
)

# The official overlay: bounds from the theme JS, viewBox of the routes SVG.
SW = (-20.12903525, -44.22784743)
NE = (-20.11823726, -44.21704688)
VIEWBOX = (0.0, 0.0, 1009.7, 1071.1)


def test_haversine_one_degree_of_latitude():
    assert haversine_m((0, 0), (1, 0)) == pytest.approx(111_195, rel=1e-3)


@pytest.mark.parametrize(("lat", "lng"), [(-20.124, -44.222), (0, 0), (60, 120)])
def test_mercator_round_trip(lat, lng):
    assert inverse_mercator(mercator_x(lng), mercator_y(lat)) == pytest.approx((lat, lng))


def test_local_projection_matches_haversine_and_round_trips():
    proj = LocalProjection(-20.124, -44.222)
    a, b = SW, NE
    xy_a, xy_b = proj.to_xy(*a), proj.to_xy(*b)
    assert math.dist(xy_a, xy_b) == pytest.approx(haversine_m(a, b), rel=1e-3)
    assert proj.to_latlng(*xy_a) == pytest.approx(a, abs=1e-12)


def test_official_overlay_is_width_limited_and_vertically_centered():
    georef = SvgGeoreference(SW, NE, VIEWBOX)
    top_left = georef.to_latlng(0, 0)
    bottom_right = georef.to_latlng(1009.7, 1071.1)
    # Horizontally the SVG spans the whole box...
    assert top_left[1] == pytest.approx(SW[1], abs=1e-9)
    assert bottom_right[1] == pytest.approx(NE[1], abs=1e-9)
    # ...vertically it is inset by the same few meters at the top and the bottom ("meet").
    top_inset = haversine_m(top_left, (NE[0], top_left[1]))
    bottom_inset = haversine_m(bottom_right, (SW[0], bottom_right[1]))
    assert 0 < top_inset < 5
    assert top_inset == pytest.approx(bottom_inset, rel=1e-2)


def test_letterboxing_with_a_wide_viewbox():
    # A square box near the equator with a 2:1 viewBox: the content uses the middle half.
    georef = SvgGeoreference((-0.01, -0.01), (0.01, 0.01), (0, 0, 200, 100))
    top_left, bottom_left = georef.to_latlng(0, 0), georef.to_latlng(0, 100)
    assert top_left[1] == pytest.approx(-0.01, abs=1e-9)
    assert top_left[0] == pytest.approx(0.005, abs=1e-6)
    assert bottom_left[0] == pytest.approx(-0.005, abs=1e-6)


@pytest.mark.parametrize(("x", "y"), [(0, 0), (504.85, 535.55), (1009.7, 1071.1), (123.4, 987.6)])
def test_svg_georeference_round_trip(x, y):
    georef = SvgGeoreference(SW, NE, VIEWBOX)
    assert georef.to_svg(*georef.to_latlng(x, y)) == pytest.approx((x, y), abs=1e-6)

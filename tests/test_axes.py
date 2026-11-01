import pytest

from inhotim_path.sources import SourceError
from inhotim_path.sources.axes import (
    from_feature_collection,
    parse_axes_svg,
    to_feature_collection,
)

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>.a{fill:none;stroke:#ff8304}</style>
  <g id="Layer_2">
    <g id="laranja"><path class="a" d="M0 10 L50 10 L100 10"/></g>
    <g id="rosa"><path d="M0 90 C 30 40, 70 40, 100 90"/></g>
  </g>
  <path d="M50 0 L50 100 M60 0 l0 100"/>
</svg>"""
SW, NE = (-0.01, -0.01), (0.01, 0.01)


def test_paths_are_tagged_with_their_route_group():
    lines, _ = parse_axes_svg(SVG, SW, NE)
    # The last path has two subpaths (two "M" commands) -> two polylines outside any route group.
    assert [line.axis for line in lines] == ["laranja", "rosa", None, None]


def test_straight_segments_keep_exact_vertices_and_curves_are_sampled():
    lines, georef = parse_axes_svg(SVG, SW, NE, step=2.0)
    laranja, rosa = lines[0], lines[1]
    assert len(laranja.coords) == 3
    assert georef.to_svg(*laranja.coords[1]) == pytest.approx((50, 10), abs=1e-6)
    assert len(rosa.coords) > 20
    assert georef.to_svg(*rosa.coords[-1]) == pytest.approx((100, 90), abs=1e-6)


def test_relative_commands_are_resolved():
    lines, georef = parse_axes_svg(SVG, SW, NE)
    relative = lines[3]  # "M60 0 l0 100"
    assert georef.to_svg(*relative.coords[0]) == pytest.approx((60, 0), abs=1e-6)
    assert georef.to_svg(*relative.coords[-1]) == pytest.approx((60, 100), abs=1e-6)


def test_lengths_are_in_meters():
    lines, _ = parse_axes_svg(SVG, SW, NE)
    # The box is ~2.2 km wide for 100 SVG units, so a full-width line is ~2.2 km.
    assert lines[0].length_m == pytest.approx(2226, rel=0.01)


def test_feature_collection_round_trip():
    lines, _ = parse_axes_svg(SVG, SW, NE)
    back = from_feature_collection(to_feature_collection(lines, source="test"))
    assert [line.axis for line in back] == [line.axis for line in lines]
    for original, restored in zip(lines, back, strict=True):
        assert len(original.coords) == len(restored.coords)
        for a, b in zip(original.coords, restored.coords, strict=True):
            assert a == pytest.approx(b, abs=1e-7)


def test_svg_without_paths_is_rejected():
    empty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
    with pytest.raises(SourceError):
        parse_axes_svg(empty, SW, NE)

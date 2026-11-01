import json
import shutil
import subprocess
from dataclasses import replace
from datetime import time

import pytest

from inhotim_path.export import clock, duration, format_itinerary, to_geojson, to_html
from inhotim_path.models import Poi, PoiKind
from inhotim_path.planner import Plan, PlanRequest, Visit

START = Poi(id=1, name="Recepção", kind=PoiKind.SERVICE, lat=-20.12, lng=-44.22)
GALLERY = Poi(id=2, name="Galeria <Praça>", kind=PoiKind.GALLERY, lat=-20.121, lng=-44.221)
SNEAKY = Poi(id=3, name="</script><b>x</b>", kind=PoiKind.OUTDOOR_WORK, lat=-20.122, lng=-44.222)


def make_plan(*, total_hours=1.0, budget_min=None, optimal=True, skipped=()):
    walk_s = 300
    dwell_s = round(total_hours * 3600) - 2 * walk_s
    visits = (
        Visit(START, arrive_s=0, dwell_s=0, walk_m=0.0, walk_s=0),
        Visit(GALLERY, arrive_s=walk_s, dwell_s=dwell_s, walk_m=333.0, walk_s=walk_s),
        Visit(START, arrive_s=2 * walk_s + dwell_s, dwell_s=0, walk_m=333.0, walk_s=walk_s),
    )
    legs = (
        ((START.lat, START.lng), (GALLERY.lat, GALLERY.lng)),
        ((GALLERY.lat, GALLERY.lng), (START.lat, START.lng)),
    )
    return Plan(
        request=PlanRequest(budget_min=budget_min),
        visits=visits,
        legs=legs,
        skipped=tuple(skipped),
        unreachable=(),
        network_stats={},
        optimal=optimal,
    )


def test_duration():
    assert duration(0) == "0 min"
    assert duration(45 * 60) == "45 min"
    assert duration(65 * 60) == "1h05"
    assert duration(14 * 3600 + 47 * 60) == "14h47"


def test_clock():
    assert clock(0, time(9, 30)) == "09:30"
    assert clock(3600, time(23, 30)) == "00:30 +1d"
    assert clock(5400, None) == "1:30"


def test_itinerary_lists_stops_with_clock_times():
    text = format_itinerary(make_plan(), time(9, 30))
    assert "Inhotim route: 1 stops · 0.7 km walking (10 min)" in text
    assert "09:35  Galeria <Praça>" in text
    assert "route quality: proven optimal" in text


def test_itinerary_reports_budget_and_left_out_stops():
    text = format_itinerary(make_plan(budget_min=90, optimal=False, skipped=[SNEAKY]))
    assert "time budget 1h30 · 1 stops left out" in text
    assert "Left out (1): </script><b>x</b>" in text
    assert "not proven optimal" in text


def test_itinerary_suggests_a_budget_for_very_long_tours():
    assert "--budget" in format_itinerary(make_plan(total_hours=12))
    assert "--budget" not in format_itinerary(make_plan(total_hours=3))


def test_geojson_has_legs_and_stops():
    data = to_geojson(make_plan(), time(9, 30))
    kinds = [f["properties"]["type"] for f in data["features"]]
    assert kinds == ["leg", "leg", "stop", "stop"]
    stop = data["features"][3]
    assert stop["geometry"]["coordinates"] == [GALLERY.lng, GALLERY.lat]
    assert stop["properties"]["time"] == "09:35"
    assert "OpenStreetMap" in data["attribution"]
    json.dumps(data)  # serializable


def test_html_escapes_names():
    plan = make_plan()
    start, gallery, back = plan.visits
    page = to_html(replace(plan, visits=(start, replace(gallery, poi=SNEAKY), back)))
    assert "</script><b>" not in page
    assert "<\\/script><b>x<\\/b>" in page  # still in the data, escaped for the script block
    assert "maplibre-gl/5.24.0" in page
    assert "OpenStreetMap" in page


def test_html_basemap_works_from_a_local_file():
    page = to_html(make_plan())
    # OSM's own tile servers block pages opened from a file: they send no Referer header.
    assert "tile.openstreetmap.org" not in page
    assert "https://tiles.openfreemap.org/styles/" in page
    assert page.count('integrity="sha512-') == 2  # MapLibre's script and stylesheet are pinned


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_html_script_is_valid_javascript(tmp_path):
    script = to_html(make_plan()).split("<script>")[1].split("</script>")[0]
    path = tmp_path / "map.js"
    path.write_text(script, encoding="utf-8")
    result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr

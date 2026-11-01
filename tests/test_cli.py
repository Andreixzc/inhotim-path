import argparse
import json
from datetime import time
from pathlib import Path

import httpx
import pytest

from inhotim_path import __version__, snapshots
from inhotim_path.cli import main, parse_clock, parse_duration, parse_dwell
from inhotim_path.models import PoiKind
from tests.synthetic_park import write_snapshots


def test_no_command_prints_help(capsys):
    assert main([]) == 0
    assert "inhotim-path" in capsys.readouterr().out


def test_version(capsys):
    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0
    assert __version__ in capsys.readouterr().out


@pytest.mark.parametrize(
    ("text", "minutes"),
    [
        ("4h", 240),
        ("5h30", 330),
        ("1.5h", 90),
        ("90m", 90),
        ("90min", 90),
        ("90", 90),
        ("2h 15m", 135),
        (" 3h ", 180),
    ],
)
def test_parse_duration(text, minutes):
    assert parse_duration(text) == minutes


@pytest.mark.parametrize("text", ["", "abc", "h", "4x"])
def test_parse_duration_rejects_garbage(text):
    with pytest.raises(argparse.ArgumentTypeError):
        parse_duration(text)


def test_parse_clock():
    assert parse_clock("09:30") == time(9, 30)
    with pytest.raises(argparse.ArgumentTypeError):
        parse_clock("9h30")


def test_parse_dwell():
    assert parse_dwell("gallery=30") == (PoiKind.GALLERY, 30.0)
    for bad in ("gallery", "statue=5", "gallery=lots"):
        with pytest.raises(argparse.ArgumentTypeError):
            parse_dwell(bad)


def test_route_end_to_end(tmp_path, capsys):
    write_snapshots(tmp_path)
    out = tmp_path / "out"
    args = ["--data-dir", str(tmp_path), "route", "--start-time", "09:30"]
    args += ["--geojson", str(out / "route.geojson"), "--html", str(out / "route.html")]
    assert main(args) == 0
    text = capsys.readouterr().out
    assert "Inhotim route: 4 stops" in text
    assert "09:30  Recepção" in text
    assert "Unreachable (too far from any known path): Galeria Longe" in text
    features = json.loads((out / "route.geojson").read_text())["features"]
    assert sum(f["properties"]["type"] == "stop" for f in features) == 5  # start + 4 stops
    assert "Galeria Praça" in (out / "route.html").read_text()


def test_route_with_budget_and_options(tmp_path, capsys):
    write_snapshots(tmp_path)
    args = ["--data-dir", str(tmp_path), "route", "--budget", "40m", "--kinds", "gallery"]
    args += ["--must", "jardim", "--dwell", "garden=5", "--speed", "5"]
    assert main(args) == 0
    text = capsys.readouterr().out
    assert "Jardim Pictórico" in text
    assert "time budget 40 min" in text


def test_route_without_snapshots_explains_how_to_fetch(tmp_path, capsys):
    assert main(["--data-dir", str(tmp_path), "route"]) == 2
    assert "inhotim-path fetch" in capsys.readouterr().err


def test_route_with_must_that_cannot_fit(tmp_path, capsys):
    write_snapshots(tmp_path)
    assert main(["--data-dir", str(tmp_path), "route", "--budget", "10m", "--must", "lago"]) == 2
    assert "no feasible route" in capsys.readouterr().err


def test_fetch_reports_whats_new_in_the_collection(tmp_path, monkeypatch, capsys):
    feed = (Path(__file__).parent / "fixtures" / "get_markers_sample.json").read_text("utf-8")
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=feed))
    monkeypatch.setattr("inhotim_path.cli.make_client", lambda: httpx.Client(transport=transport))
    fetch = ["--data-dir", str(tmp_path), "fetch", "--only", "pois"]

    assert main(fetch) == 0  # first snapshot: nothing to compare with
    assert "what's new" not in capsys.readouterr().out

    path = tmp_path / snapshots.POIS_FILE
    first, *rest = snapshots.read_pois(path)
    snapshots.write_pois(path, rest, source="test")  # as if the first POI were new on the map
    assert main(fetch) == 0
    out = capsys.readouterr().out
    assert "what's new: 1 added, 0 removed, 0 changed" in out
    assert f"+ {first.name} ({first.kind.value})" in out

    assert main(fetch) == 0
    assert "(unchanged)" in capsys.readouterr().out


def test_route_html_gets_the_satellite_key_from_the_environment(tmp_path, monkeypatch, capsys):
    write_snapshots(tmp_path)
    monkeypatch.setenv("MAPTILER_API_KEY", "key-from-env")
    page = tmp_path / "map.html"
    assert main(["--data-dir", str(tmp_path), "route", "--html", str(page)]) == 0
    assert "(with satellite view)" in capsys.readouterr().out
    assert 'const satelliteKey = "key-from-env";' in page.read_text("utf-8")

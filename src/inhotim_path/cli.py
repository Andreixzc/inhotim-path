"""Command-line interface: ``inhotim-path fetch`` and ``inhotim-path route``."""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter
from collections.abc import Sequence
from datetime import datetime, time
from pathlib import Path

import httpx

from inhotim_path import __version__, changes, export, planner, snapshots
from inhotim_path.http import make_client
from inhotim_path.models import Poi, PoiKind
from inhotim_path.solver import RouteNotFoundError
from inhotim_path.sources import axes, inhotim, osm

FETCH_STEPS = ("pois", "axes", "osm")
ROUTABLE_KINDS = (
    PoiKind.GALLERY,
    PoiKind.OUTDOOR_WORK,
    PoiKind.GARDEN,
    PoiKind.BOTANICAL,
    PoiKind.EXHIBITION,
    PoiKind.WORK_IN_GALLERY,
    PoiKind.EVENT,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="inhotim-path",
        description="Plan the best walking route through Inhotim from its live map.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=snapshots.DEFAULT_DATA_DIR,
        help="where snapshots are read/written (default: %(default)s)",
    )
    commands = parser.add_subparsers(dest="command", metavar="<command>")

    fetch = commands.add_parser("fetch", help="download the live map data into data/ snapshots")
    fetch.add_argument(
        "--only",
        nargs="+",
        choices=FETCH_STEPS,
        default=list(FETCH_STEPS),
        help="refresh only some sources (default: all)",
    )
    fetch.set_defaults(handler=cmd_fetch)

    route = commands.add_parser(
        "route",
        help="compute the best walking route",
        description="Shortest route through every stop (TSP), or the best route that fits a "
        "time budget (orienteering) when --budget is given. Works offline from data/.",
    )
    route.add_argument(
        "--budget",
        type=parse_duration,
        metavar="DURATION",
        help="time you have, e.g. 4h, 5h30, 90m (default: see everything)",
    )
    route.add_argument(
        "--kinds",
        nargs="+",
        choices=[k.value for k in ROUTABLE_KINDS],
        default=[k.value for k in planner.DEFAULT_KINDS],
        metavar="KIND",
        help="kinds of stops (default: %(default)s); choices: "
        + ", ".join(k.value for k in ROUTABLE_KINDS),
    )
    route.add_argument("--botanical", action="store_true", help="also stop at botanical highlights")
    route.add_argument(
        "--must",
        nargs="+",
        default=[],
        metavar="NAME",
        help="must-see stops: name or artist, accents/case optional (e.g. Kusama 'Beam Drop')",
    )
    route.add_argument("--exclude", nargs="+", default=[], metavar="NAME", help="stops to skip")
    route.add_argument(
        "--start", default=planner.DEFAULT_START, help="start/end point (default: %(default)s)"
    )
    route.add_argument(
        "--speed",
        type=float,
        default=planner.DEFAULT_SPEED_KMH,
        metavar="KMH",
        help="walking speed (default: %(default)s)",
    )
    route.add_argument(
        "--dwell",
        nargs="+",
        default=[],
        type=parse_dwell,
        metavar="KIND=MIN",
        help="minutes spent per kind of stop, e.g. gallery=30 outdoor_work=5",
    )
    route.add_argument(
        "--start-time", type=parse_clock, metavar="HH:MM", help="show clock times from HH:MM"
    )
    route.add_argument(
        "--time-limit",
        type=float,
        default=5.0,
        metavar="SECONDS",
        help="solver search time (default: %(default)s)",
    )
    route.add_argument("--geojson", type=Path, metavar="PATH", help="write the route as GeoJSON")
    route.add_argument("--html", type=Path, metavar="PATH", help="write a standalone map page")
    route.add_argument(
        "--satellite-key",
        default=os.environ.get("MAPTILER_API_KEY"),
        metavar="KEY",
        help="MapTiler API key: adds a satellite view to the --html map "
        "(default: $MAPTILER_API_KEY). The key is written into the page.",
    )
    route.set_defaults(handler=cmd_route)
    return parser


def parse_duration(text: str) -> float:
    """'4h' -> 240, '5h30' -> 330, '1.5h' -> 90, '90m' / '90' -> 90 (minutes)."""
    match = re.fullmatch(
        r"\s*(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min)?)?\s*", text
    )
    if not match or not any(match.groups()):
        raise argparse.ArgumentTypeError(f"invalid duration {text!r} (try 4h, 5h30, 90m)")
    hours, minutes = (float(g) if g else 0.0 for g in match.groups())
    return hours * 60 + minutes


def parse_clock(text: str) -> time:
    try:
        return datetime.strptime(text, "%H:%M").time()
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid time {text!r} (use HH:MM)") from None


def parse_dwell(text: str) -> tuple[PoiKind, float]:
    kind, _, minutes = text.partition("=")
    try:
        return PoiKind(kind.strip()), float(minutes)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"invalid dwell {text!r} (use KIND=MINUTES, e.g. gallery=30)"
        ) from None


def cmd_route(args: argparse.Namespace) -> int:
    kinds = tuple(PoiKind(k) for k in args.kinds)
    if args.botanical and PoiKind.BOTANICAL not in kinds:
        kinds += (PoiKind.BOTANICAL,)
    request = planner.PlanRequest(
        kinds=kinds,
        must=tuple(args.must),
        exclude=tuple(args.exclude),
        start=args.start,
        budget_min=args.budget,
        speed_kmh=args.speed,
        dwell_min={**planner.DEFAULT_DWELL_MIN, **dict(args.dwell)},
        time_limit_s=args.time_limit,
    )
    try:
        plan = planner.plan_route(planner.ParkData.load(args.data_dir), request)
    except (planner.PlanningError, RouteNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(export.format_itinerary(plan, args.start_time))
    if args.geojson:
        snapshots.write_json(args.geojson, export.to_geojson(plan, args.start_time))
        print(f"\nGeoJSON  -> {args.geojson}")
    if args.html:
        args.html.parent.mkdir(parents=True, exist_ok=True)
        page = export.to_html(plan, args.start_time, satellite_key=args.satellite_key)
        args.html.write_text(page, encoding="utf-8")
        print(f"HTML map -> {args.html}" + (" (with satellite view)" if args.satellite_key else ""))
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    data_dir: Path = args.data_dir
    steps = {"pois": _fetch_pois, "axes": _fetch_axes, "osm": _fetch_osm}
    with make_client() as client:
        for name in FETCH_STEPS:
            if name in args.only:
                steps[name](client, data_dir)
    return 0


def _fetch_pois(client: httpx.Client, data_dir: Path) -> None:
    raw = inhotim.fetch_markers(client)
    pois = inhotim.normalize_markers(raw)
    path = data_dir / snapshots.POIS_FILE
    previous = _read_previous_pois(path)
    changed = snapshots.write_pois(path, pois, source=inhotim.MARKERS_URL)
    kinds = Counter(p.kind.value for p in pois)
    print(f"pois: {len(raw)} markers -> {len(pois)} unique POIs -> {path} ({_status(changed)})")
    print("      " + ", ".join(f"{kind}={n}" for kind, n in kinds.most_common()))
    if changed and previous is not None:
        diff = changes.diff_pois(previous, pois)
        if not diff:
            print("      what's new: nothing notable (pins nudged or reordered)")
            return
        print(f"      what's new: {changes.summary(diff)}")
        for line in changes.describe(diff):
            print(f"        {line}")


def _read_previous_pois(path: Path) -> list[Poi] | None:
    try:
        return snapshots.read_pois(path)
    except (OSError, ValueError, KeyError, TypeError):
        return None  # first fetch, or an unreadable snapshot: nothing to compare with


def _fetch_axes(client: httpx.Client, data_dir: Path) -> None:
    assets = inhotim.fetch_map_assets(client)
    svg_text = inhotim.fetch_text(client, assets.axes_svg_url)
    lines, _ = axes.parse_axes_svg(svg_text, assets.sw, assets.ne)
    collection = axes.to_feature_collection(lines, source=assets.axes_svg_url)
    collection["overlay_bounds"] = {"sw": list(assets.sw), "ne": list(assets.ne)}
    path = data_dir / snapshots.AXES_FILE
    changed = snapshots.write_snapshot(path, collection, content_keys=["features"])
    km: Counter[str] = Counter()
    for line in lines:
        km[line.axis or "other"] += line.length_m / 1000
    print(f"axes: {len(lines)} polylines -> {path} ({_status(changed)})")
    print(f"      svg={assets.axes_svg_url.rsplit('/', 1)[-1]} bounds from {assets.bounds_from}")
    print("      " + ", ".join(f"{axis}={length:.1f} km" for axis, length in km.most_common()))


def _fetch_osm(client: httpx.Client, data_dir: Path) -> None:
    park = osm.fetch_park(client)
    snapshot = osm.to_snapshot(park, fetched_at=snapshots.iso_now())
    path = data_dir / snapshots.OSM_FILE
    changed = snapshots.write_snapshot(path, snapshot, content_keys=["boundary", "ways"])
    walkable = [w for w in park.ways if osm.is_walkable(w)]
    kinds = Counter(w.highway for w in walkable)
    print(
        f"osm:  {len(park.ways)} ways in the park, {len(walkable)} walkable -> {path} "
        f"({_status(changed)})"
    )
    print("      " + ", ".join(f"{kind}={n}" for kind, n in kinds.most_common()))


def _status(changed: bool) -> str:
    return "updated" if changed else "unchanged"


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())

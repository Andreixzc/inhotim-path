"""Command-line interface: ``inhotim-path fetch`` and ``inhotim-path route``."""

from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

import httpx

from inhotim_path import __version__, snapshots
from inhotim_path.http import make_client
from inhotim_path.sources import axes, inhotim, osm

FETCH_STEPS = ("pois", "axes", "osm")


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
    return parser


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
    changed = snapshots.write_pois(path, pois, source=inhotim.MARKERS_URL)
    kinds = Counter(p.kind.value for p in pois)
    print(f"pois: {len(raw)} markers -> {len(pois)} unique POIs -> {path} ({_status(changed)})")
    print("      " + ", ".join(f"{kind}={n}" for kind, n in kinds.most_common()))


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

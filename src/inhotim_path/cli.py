"""Command-line interface: ``inhotim-path fetch`` and ``inhotim-path route``."""

from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

from inhotim_path import __version__, snapshots
from inhotim_path.http import make_client
from inhotim_path.sources import inhotim


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
    fetch.set_defaults(handler=cmd_fetch)
    return parser


def cmd_fetch(args: argparse.Namespace) -> int:
    data_dir: Path = args.data_dir
    with make_client() as client:
        raw = inhotim.fetch_markers(client)
    pois = inhotim.normalize_markers(raw)
    path = data_dir / snapshots.POIS_FILE
    changed = snapshots.write_pois(path, pois, source=inhotim.MARKERS_URL)
    kinds = Counter(p.kind.value for p in pois)
    print(f"pois: {len(raw)} markers -> {len(pois)} unique POIs -> {path}")
    print("      " + ", ".join(f"{kind}={n}" for kind, n in kinds.most_common()))
    print("      " + ("updated" if changed else "unchanged"))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())

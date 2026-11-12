"""Draw a route GeoJSON (from ``inhotim-path route --geojson``) over the park's paths as a PNG.

Used for the figures in the README. Matplotlib is not a project dependency, so run it with:

    uv run --with matplotlib python scripts/plot_route.py ROUTE.geojson OUT.png

For example, docs/img/route-galleries.png was drawn from output/galleries.geojson.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

from inhotim_path import snapshots
from inhotim_path.export import ATTRIBUTION, KIND_COLOR
from inhotim_path.models import PoiKind
from inhotim_path.network import NetworkConfig, build_network
from inhotim_path.planner import ParkData

ROUTE_COLOR = "#e4572e"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("route", type=Path, help="GeoJSON written by inhotim-path route")
    parser.add_argument("png", type=Path, help="output image")
    parser.add_argument("--data-dir", type=Path, default=snapshots.DEFAULT_DATA_DIR)
    parser.add_argument("--title", help="title (default: the route summary)")
    args = parser.parse_args()

    route = json.loads(args.route.read_text(encoding="utf-8"))
    data = ParkData.load(args.data_dir)
    network = build_network(data.park, data.axes, [], NetworkConfig())  # what routes walk on
    proj = network.projection

    fig, ax = plt.subplots(figsize=(10, 10))
    boundary = data.park.boundary
    for polygon in getattr(boundary, "geoms", [boundary]):
        xs, ys = zip(*(proj.to_xy(lat, lng) for lng, lat in polygon.exterior.coords), strict=True)
        ax.fill(xs, ys, color="#f1f5ec", zorder=0)
        ax.plot(xs, ys, color="#b9c4ad", lw=1, zorder=1)
    for *_, edge in network.graph.edges(data=True):
        xs, ys = zip(*edge["geometry"], strict=True)
        ax.plot(xs, ys, color="#c9c9c9", lw=0.9, zorder=2)

    features = route["features"]
    route_xy: list[tuple[float, float]] = []
    for leg in (f for f in features if f["properties"]["type"] == "leg"):
        coords = leg["geometry"]["coordinates"]
        points = [proj.to_xy(lat, lng) for lng, lat in coords]
        route_xy += points
        xs, ys = zip(*points, strict=True)
        ax.plot(xs, ys, color=ROUTE_COLOR, lw=2.6, alpha=0.9, zorder=3, solid_capstyle="round")
    kinds_seen: dict[str, str] = {}
    for stop in (f for f in features if f["properties"]["type"] == "stop"):
        lng, lat = stop["geometry"]["coordinates"]
        x, y = proj.to_xy(lat, lng)
        kind = stop["properties"]["kind"]
        color = KIND_COLOR.get(PoiKind(kind), "#555555")
        kinds_seen[kind] = color
        ax.scatter(x, y, s=170, color=color, edgecolors="white", linewidths=1.2, zorder=4)
        ax.annotate(
            str(stop["properties"]["order"]),
            (x, y),
            ha="center",
            va="center",
            fontsize=6.5,
            color="white",
            weight="bold",
            zorder=5,
        )

    handles = [Line2D([], [], color=ROUTE_COLOR, lw=2.6, label="route")]
    handles += [
        Line2D([], [], marker="o", ls="", color=color, markersize=8, label=kind.replace("_", " "))
        for kind, color in kinds_seen.items()
    ]
    handles.append(Line2D([], [], color="#c9c9c9", lw=1, label="walking paths"))
    ax.legend(handles=handles, loc="lower right", frameon=True, fontsize=9)
    ax.set_title(args.title or route["summary"], fontsize=11)
    ax.text(0.0, -0.02, ATTRIBUTION, transform=ax.transAxes, fontsize=7, color="#666", va="top")
    ax.set_aspect("equal")
    ax.set_axis_off()
    if route_xy:  # fit the view to the route, as a square with some margin
        xs, ys = zip(*route_xy, strict=True)
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        half = max(max(xs) - min(xs), max(ys) - min(ys)) / 2 * 1.15 + 60
        ax.set_xlim(cx - half, cx + half)
        ax.set_ylim(cy - half, cy + half)
    args.png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.png, dpi=110, bbox_inches="tight", facecolor="white")
    print(f"saved {args.png}")


if __name__ == "__main__":
    main()

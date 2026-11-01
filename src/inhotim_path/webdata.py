"""Export the park for the web app: every POI plus the walking network, in one compact JSON file.

The browser plans routes itself from this file (Dijkstra over the network, then a heuristic solver),
so the web app needs no server. See ``history/decisions/0009-web-app-plans-in-the-browser.md``.
"""

from __future__ import annotations

from typing import Any

from inhotim_path.export import ATTRIBUTION
from inhotim_path.geo import LatLng
from inhotim_path.network import NetworkConfig, build_network
from inhotim_path.planner import (
    DEFAULT_DWELL_MIN,
    DEFAULT_KINDS,
    DEFAULT_SPEED_KMH,
    DEFAULT_START,
    ParkData,
    display_name,
    find_start,
)

FORMAT_VERSION = 1
DECIMALS = 6  # ~0.1 m


def build_web_data(
    data: ParkData,
    *,
    generated_at: str,
    fetched_at: str | None = None,
    satellite_key: str | None = None,
    config: NetworkConfig | None = None,
) -> dict[str, Any]:
    """Everything the web app needs, with graph nodes renumbered ``0..n-1``.

    ``edges`` are ``[u, v, meters, interior]``, where ``interior`` holds the ``[lng, lat]`` points
    between the two end nodes, in the u → v direction. A POI's ``node`` is ``None`` when it is too
    far from every path to be routed to.
    """
    network = build_network(data.park, data.axes, data.pois, config or NetworkConfig())
    graph, projection = network.graph, network.projection
    order = sorted(graph.nodes)
    index = {node: i for i, node in enumerate(order)}

    nodes = [_lnglat(projection.to_latlng(*graph.nodes[node]["xy"])) for node in order]
    edges = []
    for u, v, attrs in graph.edges(data=True):
        geometry = attrs["geometry"] if attrs["start"] == u else attrs["geometry"][::-1]
        interior = [_lnglat(projection.to_latlng(x, y)) for x, y in geometry[1:-1]]
        edges.append([index[u], index[v], round(attrs["length"], 2), interior])

    pois = [
        {
            "id": poi.id,
            "name": display_name(poi),
            "kind": poi.kind.value,
            "lng": round(poi.lng, DECIMALS),
            "lat": round(poi.lat, DECIMALS),
            "artists": list(poi.artists),
            "url": poi.url,
            "main_view": poi.main_view,
            "node": index[network.poi_nodes[poi.id]] if poi.id in network.poi_nodes else None,
        }
        for poi in data.pois
    ]
    return {
        "version": FORMAT_VERSION,
        "generated_at": generated_at,
        "fetched_at": fetched_at,
        "attribution": ATTRIBUTION,
        "config": {"maptiler_key": satellite_key},
        "defaults": {
            "start": find_start(data.pois, DEFAULT_START).id,
            "speed_kmh": DEFAULT_SPEED_KMH,
            "kinds": [kind.value for kind in DEFAULT_KINDS],
            "dwell_min": {kind.value: minutes for kind, minutes in DEFAULT_DWELL_MIN.items()},
        },
        "pois": pois,
        "nodes": nodes,
        "edges": edges,
    }


def _lnglat(point: LatLng) -> list[float]:
    lat, lng = point
    return [round(lng, DECIMALS), round(lat, DECIMALS)]

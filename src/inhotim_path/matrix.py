"""All-pairs walking distances between stops: one Dijkstra per stop over the walking graph."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

import networkx as nx

from inhotim_path.network import WalkNetwork


@dataclass(frozen=True)
class WalkMatrix:
    poi_ids: tuple[int, ...]
    meters: tuple[tuple[float, ...], ...]
    """``meters[i][j]``: shortest walk from ``poi_ids[i]`` to ``poi_ids[j]`` (inf if none)."""
    paths: dict[tuple[int, int], tuple[int, ...]] = field(default_factory=dict, repr=False)
    """(from poi id, to poi id) -> graph nodes along the shortest walk."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "_index", {poi_id: i for i, poi_id in enumerate(self.poi_ids)})

    def distance(self, a: int, b: int) -> float:
        index: dict[int, int] = self._index  # type: ignore[attr-defined]
        return self.meters[index[a]][index[b]]

    def path(self, a: int, b: int) -> tuple[int, ...]:
        return self.paths[(a, b)]


def walking_matrix(network: WalkNetwork, poi_ids: Sequence[int]) -> WalkMatrix:
    nodes = {poi_id: network.poi_nodes[poi_id] for poi_id in poi_ids}
    meters: list[tuple[float, ...]] = []
    paths: dict[tuple[int, int], tuple[int, ...]] = {}
    for a in poi_ids:
        lengths, routes = nx.single_source_dijkstra(network.graph, nodes[a], weight="length")
        meters.append(tuple(lengths.get(nodes[b], math.inf) for b in poi_ids))
        for b in poi_ids:
            if nodes[b] in routes:
                paths[(a, b)] = tuple(routes[nodes[b]])
    return WalkMatrix(poi_ids=tuple(poi_ids), meters=tuple(meters), paths=paths)

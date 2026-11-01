"""The walking graph: OSM paths + official routes (gap fill), clipped to the park, POIs snapped on.

Rationale in ``history/decisions/0002-walking-network-osm-plus-official-axes.md``. All geometry
is done in a local metric projection, so lengths and tolerances are plain meters.
"""

from __future__ import annotations

import itertools
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import substring, unary_union

from inhotim_path.geo import LatLng, LocalProjection
from inhotim_path.models import Poi
from inhotim_path.sources.axes import AxisLine
from inhotim_path.sources.osm import OsmPark, is_walkable

GRID_M = 0.01  # noding precision: 1 cm


@dataclass(frozen=True)
class NetworkConfig:
    boundary_buffer_m: float = 50.0
    """Keep paths up to this far outside the park polygon (entrance and parking area)."""
    gap_tolerance_m: float = 10.0
    """Official-route pieces farther than this from every OSM path are added as new paths."""
    min_gap_length_m: float = 8.0
    connect_radius_m: float = 25.0
    """Loose ends of added route pieces are linked to the nearest path within this radius."""
    dangle_snap_m: float = 3.0
    """OSM dead ends this close to another path are joined to it (digitizing gaps)."""
    max_snap_m: float = 150.0
    """POIs farther than this from every path are reported as unreachable."""
    simplify_m: float = 0.5


@dataclass
class WalkNetwork:
    graph: nx.Graph
    projection: LocalProjection
    poi_nodes: dict[int, int]
    """POI id -> graph node."""
    snap_m: dict[int, float]
    """POI id -> distance from the POI to the path it was snapped to."""
    unreachable: list[int]
    """POI ids farther than ``max_snap_m`` from every path."""
    stats: dict[str, float] = field(default_factory=dict)

    def node_latlng(self, node: int) -> LatLng:
        return self.projection.to_latlng(*self.graph.nodes[node]["xy"])

    def path_latlngs(self, nodes: Sequence[int]) -> list[LatLng]:
        """Polyline along a node path, following each edge's real geometry."""
        coords: list[tuple[float, float]] = [self.graph.nodes[nodes[0]]["xy"]] if nodes else []
        for u, v in itertools.pairwise(nodes):
            data = self.graph.edges[u, v]
            geometry = data["geometry"] if data["start"] == u else data["geometry"][::-1]
            coords.extend(geometry[1:])
        return [self.projection.to_latlng(x, y) for x, y in coords]


def build_network(
    park: OsmPark,
    axes: Sequence[AxisLine],
    pois: Sequence[Poi],
    config: NetworkConfig | None = None,
) -> WalkNetwork:
    config = config or NetworkConfig()
    center = park.boundary.centroid
    proj = LocalProjection(lat0=center.y, lng0=center.x)
    area = _project_lnglat_geometry(park.boundary, proj).buffer(config.boundary_buffer_m)

    osm_lines = [
        piece
        for way in park.ways
        if is_walkable(way)
        for piece in _lines(LineString([proj.to_xy(*c) for c in way.coords]).intersection(area))
    ]
    gaps = _route_gaps(axes, osm_lines, area, proj, config)
    connectors = _connectors(osm_lines, gaps, config)

    noded = shapely.union_all(osm_lines + gaps + connectors, grid_size=GRID_M)
    graph = nx.Graph()
    nodes = _NodeIndex(graph)
    for piece in _lines(noded):
        _add_piece(graph, nodes, list(piece.coords))
    dropped = _keep_largest_component(graph)
    stats = {  # the path network itself, before POIs are attached
        "osm_km": sum(line.length for line in osm_lines) / 1000,
        "route_gap_km": sum(line.length for line in gaps) / 1000,
        "connectors": len(connectors),
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "network_km": sum(d["length"] for *_, d in graph.edges(data=True)) / 1000,
        "dropped_components": dropped,
    }

    poi_nodes, snap_m, unreachable = _snap_pois(graph, nodes, pois, proj, config)
    return WalkNetwork(graph, proj, poi_nodes, snap_m, unreachable, stats)


# --------------------------------------------------------------------------- building blocks


def _route_gaps(
    axes: Sequence[AxisLine],
    osm_lines: list[LineString],
    area: BaseGeometry,
    proj: LocalProjection,
    config: NetworkConfig,
) -> list[LineString]:
    """Pieces of the official routes that OSM doesn't cover."""
    covered = unary_union(osm_lines).buffer(config.gap_tolerance_m) if osm_lines else None
    gaps: list[LineString] = []
    for axis in axes:
        line = LineString([proj.to_xy(*c) for c in axis.coords]).simplify(config.simplify_m)
        uncovered = line.difference(covered) if covered is not None else line
        gaps.extend(
            piece
            for piece in _lines(uncovered.intersection(area))
            if piece.length >= config.min_gap_length_m
        )
    return gaps


def _connectors(
    osm_lines: list[LineString], gaps: list[LineString], config: NetworkConfig
) -> list[LineString]:
    """Short links from loose line ends to the nearest other line.

    Gap pieces get a generous radius (they were cut out of a drawing, ~gap_tolerance_m away from
    the OSM path they continue); OSM ways only get their small digitizing gaps closed.
    """
    lines = osm_lines + gaps
    tree = STRtree(lines)
    links: list[LineString] = []
    for i, line in enumerate(lines):
        radius = config.connect_radius_m if i >= len(osm_lines) else config.dangle_snap_m
        for end in (Point(line.coords[0]), Point(line.coords[-1])):
            candidates = [j for j in tree.query(end.buffer(radius)) if j != i]
            if not candidates:
                continue
            j = min(candidates, key=lambda k: lines[k].distance(end))
            distance = lines[j].distance(end)
            if GRID_M < distance <= radius:
                target = lines[j].interpolate(lines[j].project(end))
                links.append(LineString([end, target]))
    return links


class _NodeIndex:
    """Graph nodes keyed by their coordinates on the noding grid."""

    def __init__(self, graph: nx.Graph) -> None:
        self.graph = graph
        self.by_key: dict[tuple[int, int], int] = {}

    def get(self, xy: tuple[float, float]) -> int:
        key = (round(xy[0] / GRID_M), round(xy[1] / GRID_M))
        node = self.by_key.get(key)
        if node is None:
            node = self.by_key[key] = len(self.by_key)
            self.graph.add_node(node, xy=(float(xy[0]), float(xy[1])))
        return node

    def new(self, xy: tuple[float, float], **attrs: object) -> int:
        node = len(self.by_key)
        self.by_key[(-1 - node, -1)] = node  # unique key: never collides with grid keys
        self.graph.add_node(node, xy=(float(xy[0]), float(xy[1])), **attrs)
        return node


def _add_piece(graph: nx.Graph, nodes: _NodeIndex, coords: list[tuple[float, float]]) -> None:
    """Add a polyline as an edge. Loops and parallel edges are split so no geometry is lost."""
    line = LineString(coords)
    if line.length <= GRID_M:
        return
    u, v = nodes.get(coords[0]), nodes.get(coords[-1])
    if u == v or graph.has_edge(u, v):
        half = line.length / 2
        _add_piece(graph, nodes, list(substring(line, 0, half).coords))
        _add_piece(graph, nodes, list(substring(line, half, line.length).coords))
        return
    graph.add_edge(u, v, length=line.length, geometry=tuple(coords), start=u)


def _keep_largest_component(graph: nx.Graph) -> int:
    components = sorted(
        nx.connected_components(graph),
        key=lambda c: sum(d["length"] for *_, d in graph.subgraph(c).edges(data=True)),
        reverse=True,
    )
    for component in components[1:]:
        graph.remove_nodes_from(component)
    return max(len(components) - 1, 0)


def _snap_pois(
    graph: nx.Graph,
    nodes: _NodeIndex,
    pois: Sequence[Poi],
    proj: LocalProjection,
    config: NetworkConfig,
) -> tuple[dict[int, int], dict[int, float], list[int]]:
    """Attach each POI to the closest point of the closest edge with a connector edge."""
    edges = list(graph.edges(data=True))
    lines = [LineString(d["geometry"]) for *_, d in edges]
    tree = STRtree(lines)

    on_edge: dict[int, list[tuple[float, Poi, Point]]] = defaultdict(list)
    snap_m: dict[int, float] = {}
    unreachable: list[int] = []
    for poi in pois:
        point = Point(proj.to_xy(poi.lat, poi.lng))
        index = int(tree.nearest(point))
        distance = lines[index].distance(point)
        if distance > config.max_snap_m:
            unreachable.append(poi.id)
            continue
        snap_m[poi.id] = distance
        on_edge[index].append((lines[index].project(point), poi, point))

    poi_nodes: dict[int, int] = {}
    for index, snaps in on_edge.items():
        u, v, data = edges[index]
        line = lines[index]  # oriented from data["start"]
        start = data["start"]
        end = v if start == u else u
        graph.remove_edge(u, v)
        previous_node, previous_at = start, 0.0
        for at, poi, point in sorted(snaps, key=lambda s: s[0]):
            if line.length - at <= GRID_M:
                anchor = end  # projects onto the far end: no cut needed
            elif at - previous_at > GRID_M:
                anchor = nodes.new(line.interpolate(at).coords[0])
                _add_piece_raw(graph, previous_node, anchor, substring(line, previous_at, at))
                previous_node, previous_at = anchor, at
            else:
                anchor = previous_node  # same spot as the previous cut (or the start)
            poi_node = nodes.new(point.coords[0], poi_id=poi.id)
            graph.add_edge(
                anchor,
                poi_node,
                length=snap_m[poi.id],
                geometry=(graph.nodes[anchor]["xy"], point.coords[0]),
                start=anchor,
                connector=True,
            )
            poi_nodes[poi.id] = poi_node
        _add_piece_raw(graph, previous_node, end, substring(line, previous_at, line.length))
    return poi_nodes, snap_m, unreachable


def _add_piece_raw(graph: nx.Graph, u: int, v: int, piece: BaseGeometry) -> None:
    coords = list(piece.coords)
    coords[0], coords[-1] = graph.nodes[u]["xy"], graph.nodes[v]["xy"]
    graph.add_edge(u, v, length=LineString(coords).length, geometry=tuple(coords), start=u)


def _project_lnglat_geometry(geometry: BaseGeometry, proj: LocalProjection) -> BaseGeometry:
    """(lng, lat) geometry -> local meters (vectorized)."""

    def to_xy(coords: np.ndarray) -> np.ndarray:
        return np.column_stack(
            (
                (coords[:, 0] - proj.lng0) * proj.m_per_deg_lng,
                (coords[:, 1] - proj.lat0) * proj.m_per_deg_lat,
            )
        )

    return shapely.transform(geometry, to_xy)


def _lines(geometry: BaseGeometry) -> Iterable[LineString]:
    """Flatten any geometry into its non-empty LineStrings."""
    if geometry.is_empty:
        return
    if isinstance(geometry, LineString):
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from _lines(part)

"""Network tests on a synthetic park near (0, 0) where distances are easy to compute by hand.

Layout (meters east, north):

    (200,380) ───── (300,380)      <- "rosa" official route, not in OSM: gap fill
        │
    (200,310)                      <- connector bridges the 10 m to the end of way 2
    (200,300)
        │  way 2
        │
    (50,100) ── (200,100) ── (350,100)   <- way 1 (+ "laranja" route drawn 3 m off: covered)
"""

import itertools
import math

import networkx as nx
import pytest
from shapely.geometry import box

from inhotim_path.geo import haversine_m
from inhotim_path.models import Poi, PoiKind
from inhotim_path.network import NetworkConfig, build_network
from inhotim_path.sources.axes import AxisLine
from inhotim_path.sources.osm import OsmPark, OsmWay

M = 1 / 111_195.08  # one meter in degrees at the equator (spherical model)


def at(x, y):
    """(lat, lng) of a point x meters east and y meters north of (0, 0)."""
    return (y * M, x * M)


def way(way_id, *points, highway="footway", **tags):
    return OsmWay(id=way_id, highway=highway, coords=tuple(at(*p) for p in points), tags=tags)


def poi(poi_id, x, y):
    lat, lng = at(x, y)
    return Poi(id=poi_id, name=f"P{poi_id}", kind=PoiKind.GALLERY, lat=lat, lng=lng)


WAYS = (
    way(1, (50, 100), (200, 100), (350, 100)),
    way(2, (200, 100), (200, 300)),
    way(3, (50, 200), (150, 200), highway="service", access="private"),  # staff only
    way(4, (50, 1000), (350, 1000)),  # far outside the park
)
AXES = [
    AxisLine("laranja", (at(50, 103), at(350, 103))),
    AxisLine("rosa", (at(200, 300), at(200, 380), at(300, 380))),
]
PARK = box(0, 0, 400 * M, 400 * M)  # (lng, lat)


def build(pois, *, ways=WAYS, axes=AXES, **config):
    park = OsmPark(relation_id=1, boundary=PARK, ways=ways)
    return build_network(park, axes, pois, NetworkConfig(**config))


def walk(net, a, b):
    return nx.shortest_path_length(net.graph, net.poi_nodes[a], net.poi_nodes[b], weight="length")


def test_only_walkable_ways_inside_the_park_are_used():
    net = build([])
    assert net.stats["osm_km"] == pytest.approx(0.5, abs=1e-3)  # ways 1 + 2 only


def test_uncovered_official_routes_fill_the_gaps():
    net = build([])
    # "rosa" minus the first 10 m (within tolerance of way 2): 70 m north + 100 m east.
    assert net.stats["route_gap_km"] == pytest.approx(0.17, abs=2e-3)
    assert net.stats["connectors"] == 1
    assert nx.is_connected(net.graph)


def test_shortest_walk_follows_osm_connector_and_gap():
    net = build([poi(1, 60, 90), poi(2, 300, 390)])
    assert net.snap_m[1] == pytest.approx(10, abs=0.01)
    assert net.snap_m[2] == pytest.approx(10, abs=0.01)
    # 10 snap + 140 + 200 (way 2) + 10 connector + 70 + 100 (gap) + 10 snap
    assert walk(net, 1, 2) == pytest.approx(540, abs=1)


def test_several_pois_on_one_edge_are_cut_in_order():
    net = build([poi(4, 150, 95), poi(5, 100, 95), poi(6, 100, 95)])
    assert walk(net, 4, 5) == pytest.approx(5 + 50 + 5, abs=0.1)
    assert walk(net, 5, 6) == pytest.approx(10, abs=0.1)  # same spot: shared cut node


def test_poi_at_the_end_of_an_edge():
    net = build([poi(7, 360, 100), poi(8, 40, 100)])
    assert walk(net, 7, 8) == pytest.approx(10 + 300 + 10, abs=0.1)


def test_far_pois_are_reported_unreachable():
    net = build([poi(1, 60, 90), poi(3, 390, 390)], max_snap_m=50)
    assert net.unreachable == [3]
    assert 3 not in net.poi_nodes


def test_parallel_paths_are_both_kept():
    detour = way(5, (100, 100), (100, 150), (150, 150), (150, 100))
    net = build([poi(9, 125, 160), poi(10, 125, 90)], ways=(*WAYS, detour))
    assert net.stats["network_km"] == pytest.approx(0.5 + 0.15 + 0.17 + 0.01, abs=5e-3)
    assert net.snap_m[9] == pytest.approx(10, abs=0.01)  # snapped onto the detour
    assert walk(net, 9, 10) == pytest.approx(10 + 25 + 50 + 25 + 10, abs=0.5)


def test_path_latlngs_follows_the_real_geometry():
    net = build([poi(1, 60, 90), poi(2, 300, 390)])
    nodes = nx.shortest_path(net.graph, net.poi_nodes[1], net.poi_nodes[2], weight="length")
    line = net.path_latlngs(nodes)
    assert line[0] == pytest.approx(at(60, 90), abs=1e-9)
    assert line[-1] == pytest.approx(at(300, 390), abs=1e-9)
    length = sum(haversine_m(a, b) for a, b in itertools.pairwise(line))
    assert length == pytest.approx(540, abs=1)
    assert not any(math.isnan(c) for point in line for c in point)

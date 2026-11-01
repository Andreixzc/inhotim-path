import heapq
import itertools
import json

from inhotim_path.cli import main
from inhotim_path.matrix import walking_matrix
from inhotim_path.network import NetworkConfig, build_network
from tests.synthetic_park import (
    POIS,
    WEB_FIXTURE,
    park_data,
    web_data,
    web_fixture_text,
    write_snapshots,
)


def dijkstra(data, source):
    adjacency = [[] for _ in data["nodes"]]
    for u, v, meters, _ in data["edges"]:
        adjacency[u].append((v, meters))
        adjacency[v].append((u, meters))
    dist = {source: 0.0}
    queue = [(0.0, source)]
    while queue:
        d, u = heapq.heappop(queue)
        if d > dist[u]:
            continue
        for v, meters in adjacency[u]:
            if d + meters < dist.get(v, float("inf")):
                dist[v] = d + meters
                heapq.heappush(queue, (d + meters, v))
    return dist


def test_every_poi_is_exported_and_edges_point_at_real_nodes():
    data = web_data()
    assert [p["id"] for p in data["pois"]] == [p.id for p in POIS]
    by_id = {p["id"]: p for p in data["pois"]}
    assert by_id[7]["node"] is None  # Galeria Longe: too far from any path
    assert all(by_id[i]["node"] is not None for i in (1, 2, 3, 4, 5, 6))
    assert by_id[4]["name"] == "Sem título (Amílcar de Castro)"
    n = len(data["nodes"])
    assert all(0 <= u < n and 0 <= v < n and meters > 0 for u, v, meters, _ in data["edges"])
    assert data["defaults"]["start"] == 1
    assert data["config"] == {"maptiler_key": None}


def test_walking_distances_survive_the_export():
    data = web_data()
    node = {p["id"]: p["node"] for p in data["pois"]}
    pois = [p for p in POIS if p.id != 7]
    network = build_network(park_data().park, park_data().axes, POIS, NetworkConfig())
    matrix = walking_matrix(network, [p.id for p in pois])
    for a, b in itertools.combinations(pois, 2):
        exported = dijkstra(data, node[a.id])[node[b.id]]
        assert abs(exported - matrix.distance(a.id, b.id)) < 0.1, (a.name, b.name)


def test_cli_writes_compact_json(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("MAPTILER_API_KEY", raising=False)
    write_snapshots(tmp_path)
    out = tmp_path / "web" / "park.json"
    assert main(["--data-dir", str(tmp_path), "web-data", "--out", str(out)]) == 0
    assert "6 of 7 POIs on the network" in capsys.readouterr().out
    data = json.loads(out.read_text("utf-8"))
    assert data["version"] == 1 and data["fetched_at"]
    assert ", " not in out.read_text("utf-8")[:200]  # compact separators


def test_the_javascript_fixture_is_up_to_date():
    # tests/web/ plan on this file; regenerate it with `uv run python -m tests.synthetic_park`.
    assert WEB_FIXTURE.read_text("utf-8") == web_fixture_text()

import httpx
import pytest

from inhotim_path.sources import SourceError
from inhotim_path.sources.osm import (
    OsmWay,
    fetch_overpass,
    from_snapshot,
    is_walkable,
    parse_park,
    to_snapshot,
)


def node(lat, lon):
    return {"lat": lat, "lon": lon}


# A square park whose outer ring is split across two member ways (as in real OSM data).
PAYLOAD = {
    "elements": [
        {
            "type": "relation",
            "id": 99,
            "tags": {"type": "multipolygon", "leisure": "park"},
            "members": [
                {"type": "way", "role": "outer", "geometry": [node(0, 0), node(0, 1), node(1, 1)]},
                {"type": "way", "role": "outer", "geometry": [node(1, 1), node(1, 0), node(0, 0)]},
            ],
        },
        {
            "type": "way",
            "id": 2,
            "tags": {"highway": "service", "access": "private", "lanes": "1"},
            "geometry": [node(0.2, 0.2), node(0.2, 0.8)],
        },
        {
            "type": "way",
            "id": 1,
            "tags": {"highway": "footway", "surface": "paved"},
            "geometry": [node(0.5, 0.1), node(0.5, 0.9)],
        },
        {"type": "way", "id": 3, "tags": {"highway": "footway"}, "geometry": [node(0.1, 0.1)]},
    ]
}


def test_parse_park_assembles_boundary_and_ways():
    park = parse_park(PAYLOAD, relation_id=99)
    assert park.boundary.area == pytest.approx(1.0)
    assert [w.id for w in park.ways] == [1, 2]  # sorted; way 3 has a single node -> dropped
    footway = park.ways[0]
    assert footway.coords[0] == (0.5, 0.1)  # (lat, lng)
    assert dict(park.ways[1].tags) == {"access": "private"}  # only useful tags are kept


def test_parse_park_requires_the_relation():
    with pytest.raises(SourceError):
        parse_park({"elements": []}, relation_id=99)


@pytest.mark.parametrize(
    ("highway", "tags", "expected"),
    [
        ("footway", {}, True),
        ("track", {"tracktype": "grade2"}, True),
        ("service", {"access": "private"}, False),
        ("service", {"access": "private", "foot": "yes"}, True),
        ("track", {"access": "no"}, False),
        ("path", {"foot": "no"}, False),
        ("secondary", {}, False),
    ],
)
def test_is_walkable(highway, tags, expected):
    assert (
        is_walkable(OsmWay(id=1, highway=highway, coords=((0, 0), (1, 1)), tags=tags)) is expected
    )


def test_snapshot_round_trip():
    park = parse_park(PAYLOAD, relation_id=99)
    restored = from_snapshot(to_snapshot(park, fetched_at="2026-11-01T00:00:00+00:00"))
    assert restored.relation_id == 99
    assert restored.boundary.equals(park.boundary)
    assert restored.ways == park.ways


def _client(responses):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        status, body = responses.pop(0)
        if isinstance(body, Exception):
            raise body
        return (
            httpx.Response(status, json=body)
            if isinstance(body, dict)
            else httpx.Response(status, text=body)
        )

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def test_fetch_overpass_falls_back_to_the_next_endpoint():
    client, calls = _client([(502, "at capacity"), (200, {"elements": []})])
    payload = fetch_overpass(
        client, "q", endpoints=["https://a", "https://b"], sleep=lambda s: None
    )
    assert payload == {"elements": []}
    assert calls == ["https://a", "https://b"]


def test_fetch_overpass_backs_off_between_rounds_then_gives_up():
    timeout = httpx.ConnectTimeout("slow")
    client, _ = _client([(504, "busy"), (0, timeout), (429, "slow down"), (200, "<html>")])
    sleeps = []
    with pytest.raises(SourceError, match="every endpoint failed"):
        fetch_overpass(
            client, "q", endpoints=["https://a", "https://b"], rounds=2, sleep=sleeps.append
        )
    assert sleeps == [10.0]  # one backoff between the two rounds


def test_fetch_overpass_treats_runtime_error_remarks_as_failures():
    remark = {"elements": [], "remark": "runtime error: Query timed out"}
    client, _ = _client([(200, remark), (200, {"elements": [1]})])
    payload = fetch_overpass(client, "q", endpoints=["https://a", "https://b"], sleep=lambda s: 0)
    assert payload == {"elements": [1]}

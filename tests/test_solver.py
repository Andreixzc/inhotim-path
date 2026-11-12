import math

import pytest

from inhotim_path.matrix import WalkMatrix
from inhotim_path.solver import Stop, solve


def euclidean_matrix(points):
    """A WalkMatrix over {id: (x, y)} with straight-line distances in meters."""
    ids = tuple(points)
    meters = tuple(tuple(math.dist(points[a], points[b]) for b in ids) for a in ids)
    return WalkMatrix(poi_ids=ids, meters=meters)


def circle(n, radius=100.0):
    return {
        i: (radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n))
        for i in range(n)
    }


def is_rotation_of_circle(order, n):
    inner = list(order[1:-1])
    forward = [(order[0] + k) % n for k in range(1, n)]
    return inner in (forward, forward[::-1])


def test_tsp_visits_points_on_a_circle_in_circular_order():
    points = circle(8)
    matrix = euclidean_matrix(points)
    stops = [Stop(poi_id=i) for i in range(1, 8)]
    route = solve(0, stops, matrix, speed_mps=1.0, time_limit_s=0.5)
    assert route.order[0] == route.order[-1] == 0
    assert is_rotation_of_circle(route.order, 8)
    perimeter = 8 * 2 * 100 * math.sin(math.pi / 8)
    assert route.walk_m == pytest.approx(perimeter)


def test_dwell_time_is_added_once_per_stop():
    matrix = euclidean_matrix({0: (0, 0), 1: (100, 0)})
    route = solve(0, [Stop(1, dwell_s=600)], matrix, speed_mps=1.0, time_limit_s=0.1)
    assert (route.walk_s, route.dwell_s, route.total_s) == (200, 600, 800)


def test_time_at_stops_does_not_change_the_walk():
    matrix = euclidean_matrix(circle(7))
    plain = solve(0, [Stop(i) for i in range(1, 7)], matrix, speed_mps=1.0, time_limit_s=0.5)
    slow_stops = [Stop(i, dwell_s=600 * i) for i in range(1, 7)]
    slow = solve(0, slow_stops, matrix, speed_mps=1.0, time_limit_s=0.5)
    assert slow.walk_s == plain.walk_s
    assert slow.dwell_s == 600 * sum(range(1, 7))


def test_no_stops_gives_an_empty_route():
    route = solve(0, [], euclidean_matrix({0: (0, 0)}), speed_mps=1.0)
    assert route.order == (0, 0)
    assert route.optimal


def test_small_instances_are_proven_optimal():
    points = circle(6)
    stops = [Stop(i) for i in range(1, 6)]
    assert solve(0, stops, euclidean_matrix(points), speed_mps=1.0).optimal


def test_every_stop_must_be_reachable():
    matrix = WalkMatrix(poi_ids=(0, 1), meters=((0.0, math.inf), (math.inf, 0.0)))
    with pytest.raises(ValueError, match="reachable"):
        solve(0, [Stop(1)], matrix, speed_mps=1.0)

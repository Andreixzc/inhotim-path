import math

import pytest

from inhotim_path.matrix import WalkMatrix
from inhotim_path.solver import InfeasibleRouteError, Stop, solve


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
    assert route.skipped == ()
    perimeter = 8 * 2 * 100 * math.sin(math.pi / 8)
    assert route.walk_m == pytest.approx(perimeter)


def test_dwell_time_is_added_once_per_stop():
    matrix = euclidean_matrix({0: (0, 0), 1: (100, 0)})
    route = solve(0, [Stop(1, dwell_s=600)], matrix, speed_mps=1.0, time_limit_s=0.1)
    assert (route.walk_s, route.dwell_s, route.total_s) == (200, 600, 800)


def test_budget_keeps_the_most_valuable_stops():
    # Two clusters 300 m east and 300 m west. Only one side fits in the budget.
    points = {0: (0, 0), 1: (300, 0), 2: (310, 0), 3: (-300, 0), 4: (-310, 0)}
    stops = [Stop(1, value=1), Stop(2, value=1), Stop(3, value=5), Stop(4, value=5)]
    route = solve(0, stops, euclidean_matrix(points), speed_mps=1.0, budget_s=700, time_limit_s=0.5)
    assert set(route.order) == {0, 3, 4}
    assert set(route.skipped) == {1, 2}
    assert route.total_s <= 700


def test_budget_prefers_more_stops_of_equal_value_when_they_fit():
    points = {0: (0, 0), 1: (100, 0), 2: (0, 100), 3: (-100, 0), 4: (0, -1000)}
    stops = [Stop(i, value=1) for i in (1, 2, 3, 4)]
    route = solve(0, stops, euclidean_matrix(points), speed_mps=1.0, budget_s=600, time_limit_s=0.5)
    assert set(route.order) == {0, 1, 2, 3}
    assert route.skipped == (4,)


def test_mandatory_stops_are_kept_even_if_less_valuable():
    points = {0: (0, 0), 1: (300, 0), 2: (-300, 0)}
    stops = [Stop(1, value=1, mandatory=True), Stop(2, value=10)]
    route = solve(0, stops, euclidean_matrix(points), speed_mps=1.0, budget_s=700, time_limit_s=0.3)
    assert route.order == (0, 1, 0)
    assert route.skipped == (2,)


def test_infeasible_mandatory_stops_raise():
    points = {0: (0, 0), 1: (1000, 0)}
    stops = [Stop(1, mandatory=True)]
    with pytest.raises(InfeasibleRouteError):
        solve(0, stops, euclidean_matrix(points), speed_mps=1.0, budget_s=100, time_limit_s=0.2)

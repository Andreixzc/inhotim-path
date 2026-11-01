import itertools
import math

import pytest

from inhotim_path.matrix import WalkMatrix
from inhotim_path.solver import InfeasibleRouteError, Stop, _polish, solve


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


def test_far_mandatory_stop_still_leaves_room_for_optional_ones():
    # Cheap optional stops cluster around the depot; a greedy start that fills the budget with
    # them can't fit the far mandatory stop (this is what broke OR-Tools' PATH_CHEAPEST_ARC).
    # Optimum: the 800 s round trip to stop 7 plus 4 of the 6 nearby stops (961 s); 5 need 1002 s.
    points = {0: (0, 0), 7: (400, 0)}
    points |= {i: (0, 10 * i) for i in (1, 2, 3)} | {i: (0, -10 * (i - 3)) for i in (4, 5, 6)}
    stops = [Stop(i, dwell_s=30) for i in range(1, 7)] + [Stop(7, mandatory=True)]
    route = solve(0, stops, euclidean_matrix(points), speed_mps=1.0, budget_s=980, time_limit_s=2)
    assert 7 in route.order
    assert len(set(route.order) - {0, 7}) == 4
    assert route.total_s <= 980


def test_nothing_fits_gives_an_empty_route():
    points = {0: (0, 0), 1: (500, 0), 2: (-500, 0)}
    stops = [Stop(1), Stop(2)]
    route = solve(0, stops, euclidean_matrix(points), speed_mps=1.0, budget_s=100, time_limit_s=1)
    assert route.order == (0, 0)
    assert set(route.skipped) == {1, 2}
    assert route.total_s == 0


def test_no_stops_gives_an_empty_route():
    route = solve(0, [], euclidean_matrix({0: (0, 0)}), speed_mps=1.0)
    assert route.order == (0, 0)
    assert route.optimal


def test_small_instances_are_proven_optimal():
    points = circle(6)
    stops = [Stop(i) for i in range(1, 6)]
    assert solve(0, stops, euclidean_matrix(points), speed_mps=1.0).optimal
    assert solve(0, stops, euclidean_matrix(points), speed_mps=1.0, budget_s=10_000).optimal


def test_polish_reorders_a_zigzag():
    # Points on a line visited out of order: 0 -> 2 -> 1 -> 3 -> 0 walks 800; the best tours
    # walk twice the span, 600.
    xs = [0, 100, 200, 300]
    cost = [[abs(a - b) for b in xs] for a in xs]
    polished = _polish(cost, [0, 2, 1, 3, 0], time_limit_s=1, workers=2)
    assert polished[0] == polished[-1] == 0
    assert sorted(polished[1:-1]) == [1, 2, 3]
    assert sum(cost[a][b] for a, b in itertools.pairwise(polished)) == 600


def test_polish_keeps_an_already_optimal_order():
    xs = [0, 100, 200, 300]
    cost = [[abs(a - b) for b in xs] for a in xs]
    assert _polish(cost, [0, 1, 2, 3, 0], time_limit_s=1, workers=2) == [0, 1, 2, 3, 0]

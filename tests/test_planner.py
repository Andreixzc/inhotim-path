import itertools

import pytest

from inhotim_path.models import PoiKind
from inhotim_path.planner import (
    ParkData,
    PlanningError,
    PlanRequest,
    display_name,
    find_start,
    plan_route,
    search,
)
from inhotim_path.solver import InfeasibleRouteError
from tests.synthetic_park import POIS, park_data


def ids(visits):
    return [v.poi.id for v in visits]


def poi_ids(pois):
    return sorted(p.id for p in pois)


def test_full_tour_visits_every_reachable_stop_and_returns():
    plan = plan_route(park_data(), PlanRequest())
    assert plan.visits[0].poi.id == plan.visits[-1].poi.id == 1
    assert sorted(ids(plan.stops)) == [2, 3, 4, 5]  # 6 is inside a gallery, 7 is unreachable
    assert poi_ids(plan.unreachable) == [7]
    assert plan.skipped == ()
    assert plan.optimal


def test_timeline_adds_up():
    plan = plan_route(park_data(), PlanRequest())
    for previous, visit in itertools.pairwise(plan.visits):
        assert visit.arrive_s == previous.arrive_s + previous.dwell_s + visit.walk_s
    assert plan.visits[0].dwell_s == plan.visits[-1].dwell_s == 0
    assert plan.stops[0].dwell_s > 0
    assert plan.total_s == plan.visits[-1].arrive_s == plan.walk_s + plan.dwell_s


def test_legs_run_from_stop_to_stop():
    plan = plan_route(park_data(), PlanRequest())
    assert len(plan.legs) == len(plan.visits) - 1
    for leg, origin, target in zip(plan.legs, plan.visits[:-1], plan.visits[1:], strict=True):
        assert leg[0] == pytest.approx((origin.poi.lat, origin.poi.lng), abs=1e-7)
        assert leg[-1] == pytest.approx((target.poi.lat, target.poi.lng), abs=1e-7)


def test_budget_keeps_the_stop_worth_the_most_minutes():
    # 30 min: the nearby gallery (160 m away, 20 min) fits alone; any pair takes longer.
    plan = plan_route(park_data(), PlanRequest(budget_min=30))
    assert ids(plan.stops) == [2]
    assert poi_ids(plan.skipped) == [3, 4, 5]
    assert plan.stops[0].walk_m == pytest.approx(160, abs=1)
    assert plan.total_s <= 30 * 60


def test_must_adds_stops_of_other_kinds():
    plan = plan_route(park_data(), PlanRequest(kinds=(PoiKind.GALLERY,), must=("jardim",)))
    assert sorted(ids(plan.stops)) == [2, 3, 5]


def test_must_is_kept_under_a_tight_budget():
    plan = plan_route(park_data(), PlanRequest(budget_min=30, must=("amilcar",)))
    assert 4 in ids(plan.stops)


def test_must_that_cannot_fit_is_an_error():
    with pytest.raises(InfeasibleRouteError):
        plan_route(park_data(), PlanRequest(budget_min=10, must=("lago",)))


def test_exclude_drops_stops():
    plan = plan_route(park_data(), PlanRequest(exclude=("lago",)))
    assert 3 not in ids(plan.stops)


def test_unknown_must_is_an_error():
    with pytest.raises(PlanningError, match="doesn't match"):
        plan_route(park_data(), PlanRequest(must=("mona lisa",)))


def test_start_far_from_paths_is_an_error():
    with pytest.raises(PlanningError, match="too far"):
        plan_route(park_data(), PlanRequest(start="Galeria Longe"))


def test_search_ignores_accents_and_case_and_matches_artists():
    assert [p.id for p in search(POIS, "praca")] == [2]
    assert [p.id for p in search(POIS, "AMILCAR")] == [4]
    assert search(POIS, "   ") == []


def test_find_start_prefers_an_exact_name():
    assert find_start(POIS, "galeria praça").id == 2
    with pytest.raises(PlanningError, match="ambiguous"):
        find_start(POIS, "galeria")
    with pytest.raises(PlanningError, match="no start point"):
        find_start(POIS, "bilheteria")


def test_display_name_adds_the_artist_to_untitled_works():
    by_id = {p.id: p for p in POIS}
    assert display_name(by_id[4]) == "Sem título (Amílcar de Castro)"
    assert display_name(by_id[2]) == "Galeria Praça"


def test_missing_snapshots_say_how_to_fetch(tmp_path):
    with pytest.raises(PlanningError, match="inhotim-path fetch"):
        ParkData.load(tmp_path)

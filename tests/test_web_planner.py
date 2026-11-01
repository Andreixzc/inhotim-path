"""The web app's JavaScript planner agrees with the Python planner (run through node).

Both plan the synthetic park: few enough stops that CP-SAT proves its routes optimal and the
JavaScript solver checks every subset and order, so the two must find equally good routes.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from inhotim_path.models import PoiKind
from inhotim_path.planner import DEFAULT_DWELL_MIN, PlanRequest, plan_route
from tests.synthetic_park import WEB_FIXTURE, park_data

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

CASES = [
    (PlanRequest(), {}),
    (PlanRequest(budget_min=30), {"budgetMin": 30}),
    (PlanRequest(budget_min=45), {"budgetMin": 45}),
    (PlanRequest(budget_min=60), {"budgetMin": 60}),
    (PlanRequest(must=("Obra interna",), budget_min=45), {"must": [6], "budgetMin": 45}),
    (PlanRequest(exclude=("Galeria Lago",)), {"exclude": [3]}),
    (
        PlanRequest(kinds=(PoiKind.GALLERY, PoiKind.GARDEN), budget_min=40),
        {"kinds": ["gallery", "garden"], "budgetMin": 40},
    ),
    (
        PlanRequest(speed_kmh=3, dwell_min={**DEFAULT_DWELL_MIN, PoiKind.GALLERY: 30}),
        {"speedKmh": 3, "dwellMin": {"gallery": 30}},
    ),
]


def plan_in_javascript(requests):
    output = subprocess.run(
        ["node", str(ROOT / "scripts" / "web_plan.mjs"), str(WEB_FIXTURE), json.dumps(requests)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(output)


def test_both_planners_find_equally_good_routes():
    results = plan_in_javascript([js for _, js in CASES])
    for (request, js_request), js in zip(CASES, results, strict=True):
        plan = plan_route(park_data(), request)
        assert plan.optimal, js_request
        python_order = [visit.poi.id for visit in plan.visits]
        label = f"{js_request}: python {python_order}, javascript {js['order']}"
        assert sorted(js["order"]) == sorted(python_order), label
        assert js["dwell_s"] == plan.dwell_s, label
        # Walks are rounded to whole seconds on each leg, from distances that agree within 0.1 m.
        assert abs(js["total_s"] - plan.total_s) <= len(plan.visits) - 1, label
        assert js["skipped"] == sorted(p.id for p in plan.skipped), label
        assert js["unreachable"] == [p.id for p in plan.unreachable], label

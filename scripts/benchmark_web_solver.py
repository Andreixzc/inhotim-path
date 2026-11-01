"""Compare the web app's JavaScript planner with the CP-SAT planner on the real park data.

    uv run python scripts/benchmark_web_solver.py [--time-limit 30]

Needs node and the snapshots in data/. For each request, CP-SAT plans once (with the time limit)
and the JavaScript planner plans with five seeds. Both report the minutes at stops ("value", what
budget routes maximize) and the total minutes. Prints a Markdown table and a summary; the results
are recorded in history/decisions/0009-web-app-plans-in-the-browser.md.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import time
from pathlib import Path

from inhotim_path.models import PoiKind
from inhotim_path.planner import ParkData, PlanRequest, plan_route, search
from inhotim_path.webdata import build_web_data

ROOT = Path(__file__).resolve().parent.parent
ART = (PoiKind.GALLERY, PoiKind.OUTDOOR_WORK, PoiKind.GARDEN)
ALL = (*ART, PoiKind.BOTANICAL)
MUST = ("Galeria Adriana Varejão", "Galeria Cosmococa", "Beam Drop Inhotim")
SEEDS = (1, 2, 3, 4, 5)
BUDGETS = (90, 120, 150, 180, 210, 240, 300, 360, 420, 480)

CASES = [
    ("art, everything", ART, None, ()),
    ("art + botanical, everything", ALL, None, ()),
    *((f"art, {b} min", ART, b, ()) for b in BUDGETS),
    *((f"art + botanical, {b} min", ALL, b, ()) for b in BUDGETS),
    ("art, 180 min, 3 must-sees", ART, 180, MUST),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--time-limit", type=float, default=30.0, help="CP-SAT seconds per route")
    args = parser.parse_args()

    data = ParkData.load(ROOT / "data")
    requests = []
    for _, kinds, budget, must in CASES:
        must_ids = sorted({p.id for query in must for p in search(data.pois, query)})
        for seed in SEEDS:
            requests.append(
                {
                    "kinds": [k.value for k in kinds],
                    "budgetMin": budget,
                    "must": must_ids,
                    "seed": seed,
                }
            )
    with tempfile.TemporaryDirectory() as tmp:
        park = Path(tmp) / "park.json"
        park.write_text(json.dumps(build_web_data(data, generated_at="benchmark")), "utf-8")
        output = subprocess.run(
            ["node", str(ROOT / "scripts" / "web_plan.mjs"), str(park), json.dumps(requests)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    results = json.loads(output)

    print("| request | CP-SAT: value, total | JS, 5 seeds: value | JS total | CP-SAT | JS |")
    print("|---|---|---|---|---|---|")
    matched = shorter = runs = 0
    js_ms = []
    for index, (name, kinds, budget, must) in enumerate(CASES):
        started = time.monotonic()
        plan = plan_route(
            data,
            PlanRequest(kinds=kinds, must=must, budget_min=budget, time_limit_s=args.time_limit),
        )
        seconds = time.monotonic() - started
        ours = results[index * len(SEEDS) : (index + 1) * len(SEEDS)]
        values = [r["dwell_s"] // 60 for r in ours]
        best = plan.dwell_s // 60
        for r in ours:
            runs += 1
            js_ms.append(r["ms"])
            same_value = r["dwell_s"] // 60 == best
            matched += r["dwell_s"] // 60 > best or (same_value and r["total_s"] <= plan.total_s)
            shorter += same_value and r["total_s"] > plan.total_s
        proven = "*" if plan.optimal else ""
        slowest = max(r["ms"] for r in ours)
        print(
            f"| {name} | {best}, {plan.total_s / 60:.1f}{proven} | {', '.join(map(str, values))} | "
            f"{ours[0]['total_s'] / 60:.1f} | {seconds:.1f} s | {slowest:.0f} ms |"
        )
    print(
        f"\n\\* proven optimal. Values and totals in minutes; JS total for seed 1. "
        f"JS matched or beat CP-SAT in {matched}/{runs} runs; "
        f"{shorter} more had the same value with a longer walk. "
        f"JS time: median {sorted(js_ms)[len(js_ms) // 2]:.0f} ms, max {max(js_ms):.0f} ms."
    )


if __name__ == "__main__":
    main()

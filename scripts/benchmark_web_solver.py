"""Compare the web app's JavaScript planner with the CP-SAT planner on the real park data.

    uv run python scripts/benchmark_web_solver.py [--time-limit 30]

Needs node and the snapshots in data/. Every mix of the web app's four categories is planned once
by CP-SAT (with the time limit) and by the JavaScript planner with five seeds. Both visit every
stop chosen, so the shorter walk is the better route. Prints a Markdown table and a summary.
Earlier results are recorded in history/decisions/0009-web-app-plans-in-the-browser.md.
"""

from __future__ import annotations

import argparse
import itertools
import json
import subprocess
import tempfile
import time
from pathlib import Path

from inhotim_path.models import PoiKind
from inhotim_path.planner import ParkData, PlanRequest, plan_route
from inhotim_path.webdata import build_web_data

ROOT = Path(__file__).resolve().parent.parent
CATEGORIES = {
    PoiKind.GALLERY: "galleries",
    PoiKind.OUTDOOR_WORK: "open-air works",
    PoiKind.GARDEN: "gardens",
    PoiKind.BOTANICAL: "botanical",
}
CASES = [mix for size in range(1, 5) for mix in itertools.combinations(CATEGORIES, size)]
SEEDS = (1, 2, 3, 4, 5)
#: Both planners round each leg to whole seconds, so equally good routes can differ by a meter.
TOLERANCE_M = 1.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--time-limit", type=float, default=30.0, help="CP-SAT seconds per route")
    args = parser.parse_args()

    data = ParkData.load(ROOT / "data")
    requests = [
        {"kinds": [k.value for k in kinds], "seed": seed} for kinds in CASES for seed in SEEDS
    ]
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

    print("| categories | stops | CP-SAT walk | JS walk, 5 seeds | CP-SAT | JS |")
    print("|---|---|---|---|---|---|")
    matched = runs = 0
    js_ms = []
    for index, kinds in enumerate(CASES):
        started = time.monotonic()
        plan = plan_route(data, PlanRequest(kinds=kinds, time_limit_s=args.time_limit))
        seconds = time.monotonic() - started
        ours = results[index * len(SEEDS) : (index + 1) * len(SEEDS)]
        for r in ours:
            runs += 1
            js_ms.append(r["ms"])
            matched += r["walk_m"] <= plan.walk_m + TOLERANCE_M
        walks = " / ".join(f"{w:,} m" for w in sorted({round(r["walk_m"]) for r in ours}))
        proven = "*" if plan.optimal else ""
        print(
            f"| {' + '.join(CATEGORIES[k] for k in kinds)} | {len(plan.stops)} | "
            f"{plan.walk_m:,.0f} m{proven} | {walks} | {seconds:.1f} s | "
            f"{max(r['ms'] for r in ours):.0f} ms |"
        )
    print(
        f"\n\\* proven optimal. JS walked no more than CP-SAT (within {TOLERANCE_M:g} m) in "
        f"{matched}/{runs} runs. JS time: median {sorted(js_ms)[len(js_ms) // 2]:.0f} ms, "
        f"max {max(js_ms):.0f} ms."
    )


if __name__ == "__main__":
    main()

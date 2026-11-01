# 0009: The web app is a static site that plans routes in the browser

- **Status:** accepted
- **Date:** 2026-11-01

## Context

- The goal is a simple web app to plan a visit, at home or on site ([vision](../../docs/vision.md)), so mostly on
  phones, sometimes with a weak signal inside the park.
- The Python planner solves with OR-Tools CP-SAT, which doesn't run in a browser ([0003](0003-python-uv-ortools.md)).
  The options were: precomputed routes (only fixed requests), a small API running CP-SAT (a server to pay for and
  keep up, and every visitor's request leaves the phone), or a heuristic in the browser.
- The data changes daily; [0007](0007-daily-data-refresh.md) already keeps `data/` current with a scheduled job.

## Decision

**A static site in `web/`, hosted on GitHub Pages, that plans every route in the browser.**

- **Data:** `inhotim-path web-data` exports `park.json` (about 74 KB): every POI's factual metadata, and the walking
  network as nodes (`[lng, lat]`) and edges (meters and shape). The Pages workflow builds it from the committed
  snapshots, and the daily refresh republishes it.
- **Planning in the browser** (`web/js/`, plain ES modules, no build step, no npm dependencies):
  - `network.js`: Dijkstra over the paths, and snapping a GPS position onto them.
  - `solver.js`: with up to 12 stops, Held-Karp dynamic programming checks every subset and order, so the route is
    optimal. Beyond that, heuristics:
    - **full tours:** iterated local search (cheapest insertion, then 2-opt and or-opt, with double-bridge kicks);
    - **budgets:** four independent searches, keeping the best. Each one fills the route by value per added minute,
      swaps stops, and kicks the route in three ways: drop a stretch of it, drop a few random stops, or force a new
      stop in. The chosen stops are then re-ordered.

    Seeded, so the same request gives the same route.
  - `plan.js`: the same rules as `planner.py` (which stops, minutes per kind, value = minutes, walks rounded to whole
    seconds per leg). A pytest test plans the synthetic park with both and checks that they agree.
  - It runs in a web worker, so the page stays responsive.
- **Privacy:** the visitor's position is only used on the phone, and is never put in a shared link.
- **Map:** MapLibre with OpenFreeMap, like the CLI's map ([0006](0006-basemap-openfreemap.md)), plus the optional
  satellite view ([0008](0008-satellite-view-maptiler.md)) when the build has a `MAPTILER_API_KEY` variable.

## Benchmark

`scripts/benchmark_web_solver.py` compares the two planners on the real park (snapshots of 2026-11-01). CP-SAT ran
30 s per route with 8 workers. The JavaScript planner ran with 5 seeds, on a laptop. "Value" is the minutes at stops,
which budget routes maximize first ([0005](0005-stop-value-is-viewing-time.md)).

| request | CP-SAT: value, total (min) | JS value, 5 seeds | JS total, seed 1 | JS time (max) |
|---|---|---|---|---|
| art, see everything (58 stops) | 710, 887.0 (optimal) | 710 ×5 | 887.0 | 63 ms |
| art + botanical, see everything (89 stops) | 803, 996.2 (optimal) | 803 ×5 | 996.2 | 135 ms |
| art, 2 h | 104, 117.8 (optimal) | 104 ×5 | 119.0 | 31 ms |
| art, 3 h | 160, 179.2 (optimal) | 160, 158, 158, 160, 158 | 179.2 | 53 ms |
| art, 3 h 30 | 186, 209.4 (optimal) | 184, 186, 186, 186, 184 | 207.4 | 88 ms |
| art, 4 h | 212, 238.8 | 212 ×5 | 239.7 | 96 ms |
| art, 6 h | 318, 358.2 (optimal) | 316, 318, 316, 316, 316 | 357.4 | 132 ms |
| art, 8 h | 418, 479.0 (optimal) | 418 ×5 | 479.0 | 150 ms |
| art + botanical, 4 h | 214, 239.4 (optimal) | 213 ×5 | 238.6 | 173 ms |
| art + botanical, 8 h | 423, 480.0 (optimal) | 423 ×5 | 480.0 | 428 ms |
| art, 3 h, 3 must-sees | 136, 178.8 | 136 ×5 | 178.8 | 31 ms |

Over all 23 requests × 5 seeds (115 runs; the full table comes from the script):

- **Value:** the JavaScript planner matched CP-SAT's value in 100 runs. The other 15 were short by 1 or 2 minutes of
  art.
- **Walking at equal value:** the JavaScript route was the same or shorter in 70 of those runs, and otherwise up to
  about 1.5 minutes longer.
- **Speed:** median 107 ms, worst 428 ms.

## Consequences

- ✅ No server: hosting is free, nothing to keep running, and re-planning is instant. That makes skipping or adding
  a stop, or starting from "here", interactive.
- ✅ Planning works without a connection once the page is loaded. An offline-capable PWA is a small step from here.
- ⚠️ Heuristic routes can be a minute or two of art short of the optimum, or walk a minute more. That is well within
  the uncertainty of the minutes guessed per stop. The CLI stays the reference, with optimality proofs.
- ⚠️ There are now two planners. `tests/test_web_planner.py` and the shared fixture
  (`tests/fixtures/synthetic_park.json`) catch drift, but rule changes must be made in both.
- ⚠️ Phones are slower than the laptop measured: maybe 3–5×, so up to about 2 s for the largest requests. That is
  not yet measured on a real device.
- ➡️ If the heuristics ever fall short: precompute popular requests with CP-SAT when the site is built, or add a small
  API. `park.json` and the page wouldn't change.

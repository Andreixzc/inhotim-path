# 0015: No time budget in the command line either

- **Status:** accepted. Supersedes [0005](0005-stop-value-is-viewing-time.md) and the budget mode of
  [0004](0004-cp-sat-circuit-solver.md).
- **Date:** 2026-11-11

## Context

- [0010](0010-web-app-without-times.md) took times and the time limit out of the web app on 2026-11-01. The
  command line kept `--budget` (the best route for N hours), and with it
  [0005](0005-stop-value-is-viewing-time.md): a stop is worth its viewing minutes.
- The browser planner kept the budget too, only to mirror `planner.py` and pass the parity test. The page never
  set one, so its orienteering search was tested but never used.
- On 2026-11-11 Andrei asked *"i tought we removed the time budget, didint we?"*, then: *"yes remove the budget
  from the cli too"*.

## Decision

**Every route, on the command line as on the web, is the shortest walk through every stop chosen.**

- `inhotim-path route` has no `--budget`. What to see is set by `--kinds`, `--botanical`, `--must` and
  `--exclude`. `--must` now just adds stops, whatever their kind and whether or not they're on the main map.
- **CP-SAT** solves the plain circuit, the same model the full tour always used. Gone: optional stops (a
  self-loop with a penalty), the time cap, the reordering pass ("polish") and `InfeasibleRouteError`.
- **The browser** keeps Held-Karp up to 12 stops and the tour heuristics. The orienteering search goes, and so do
  the request's `budgetMin` and the plan's `skipped` and `feasible`.
- `--speed`, `--dwell` and `--start-time` stay: the itinerary still estimates times. They don't change the route,
  because the time at stops adds up the same in any order. When a tour takes more than 8 hours, the itinerary
  says so and suggests `--kinds` or `--exclude`.

The benchmark (`scripts/benchmark_web_solver.py`, about 10 s) now plans each of the 15 mixes of the web app's four
categories, once with CP-SAT and with five seeds in the browser planner. On 2026-11-11:

| Mix | Stops | CP-SAT, proven optimal | Browser |
|---|---|---|---|
| Galleries | 23 | 8,432 m in 0.1 s | the same, 20 ms |
| Galleries, open-air works, gardens (the default) | 58 | 11,805 m in 0.3 s | the same, 41 ms |
| Galleries, open-air works, botanical | 80 | 12,363 m in 0.8 s | the same with 3 seeds, 1.3 m longer with 2 |
| All four | 89 | 12,877 m in 1.0 s | the same, 144 ms |

CP-SAT proved every mix optimal, in 0.1 to 2.6 s. The browser planner matched it in 73 of 75 runs. Its walks were
identical before and after this change in all 75 runs, so the page's routes didn't change.

## Consequences

- ✅ One kind of route everywhere, and less code to keep in sync: about 600 lines fewer, counting the tests.
  `solver.js` went from 486 lines to 235, and `solver.py` from 210 to 114.
- ✅ No route depends on a guess about the visitor. Pace and minutes per stop only set the itinerary's clock.
- ⚠️ "I have N hours" is the visitor's call now: fewer categories, or stops skipped or added.
- ⚠️ Breaking change: a script that passes `--budget` fails with "unrecognized arguments". There are no releases,
  and the README is updated.
- ➡️ Multi-day plans (roadmap, Phase 2) will need their own decision: splitting stops into days needs a length per
  day, which is close to a budget again.

# 0004: CP-SAT circuit model instead of the OR-Tools routing library

- **Status:** accepted. Supersedes the "routing solver" part of [0003](0003-python-uv-ortools.md). Its budget mode is
  gone since [0015](0015-no-time-budget-in-the-command-line.md).
- **Date:** 2026-11-01

## Context

The first solver used the OR-Tools routing library (its vehicle-routing API):

- optional stops were disjunctions with a penalty;
- a time dimension enforced the budget;
- the search was `PATH_CHEAPEST_ARC` followed by guided local search.

On the real data (58 default stops) it had three problems:

- **No route at all with must-sees plus a budget.** `PATH_CHEAPEST_ARC` fills the budget with cheap optional
  stops. Then it can't place the mandatory ones, and it backtracks until the time limit runs out.
- **No strategy worked everywhere.** Insertion heuristics fixed feasibility but collected less value when there
  were no must-sees. Running a portfolio of strategies split the time limit, so each one did worse.
- **No quality guarantee.** Local search can't tell how far a route is from the best one possible.

## Decision

Model the route as **one circuit** using CP-SAT's `AddCircuit`:

- there is a boolean per arc, and an optional stop takes its self-loop when it is left out;
- the total time must be ≤ the budget;
- the objective is lexicographic: collected value first, then total time.

CP-SAT runs with 8 workers under the time limit. In budget mode, when the main solve isn't proven optimal, the
order of the chosen stops is re-solved as a small TSP.

Benchmarks on 2026-11-01, real data, 5 s per run. "Value" is the points collected under the per-kind weights
used at the time (gallery 10, outdoor work 6, garden 5). The bounds are CP-SAT's proven upper bounds.

| Scenario | Best routing-library strategy | CP-SAT |
|---|---|---|
| 4 h | 131 | 132 (134 at 20 s; bound 135) |
| 6 h | 190 | **193, proven maximum value** |
| 8 h | 246 | 249 (bound 250) |
| 4 h + 2 must-sees | 128 (`PATH_CHEAPEST_ARC`, `SAVINGS`: no route) | **130, proven optimal** in 2.3 s |
| 6 h + 2 must-sees | 188 (`PATH_CHEAPEST_ARC`, `SAVINGS`: no route) | 192 (bound 193) |
| 6 h, 103 stops (every kind) | 195 | 206 |
| Full tour, 58 stops | 14h47 | 14h47, **proven optimal in 0.2 s** |
| Full tour, 103 stops | 16h55 | 16h53, proven optimal in 1.5 s |

The number of workers matters. At 6 h, 1 worker reached 114 (worse than the routing library), 2 workers 192,
4 workers 190 and 8 workers 193.

## Consequences

- ✅ Must-sees with a budget always work. Infeasibility is *proven*, so the CLI can say so plainly. A timeout is
  reported separately (`RouteNotFoundError`).
- ✅ Better routes in the same time, and the itinerary can say "proven optimal". The default full tour always is.
- ✅ Simpler code: one model for both modes, an integer cost matrix, and no first-solution strategy to tune.
- ⚠️ CP-SAT needs several threads to do well. The worker count is fixed at 8, so slower machines are slower
  but give similar results.
- ⚠️ A multi-threaded search under a wall-clock limit isn't bit-for-bit reproducible. Two runs can return
  different routes of equal or near-equal quality. If that ever matters, CP-SAT has deterministic time limits.
- ➡️ Multi-days: one circuit per day, with each stop in at most one day.
- The browser caveat from 0003 still applies. CP-SAT doesn't run in the browser either.

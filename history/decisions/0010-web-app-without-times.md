# 0010: The web app shows no times and sets no time limit

- **Status:** accepted; what to see is set by [0011](0011-what-galleries-and-everything-cover.md) and
  [0012](0012-choose-what-to-see-by-category.md)
- **Date:** 2026-11-01

## Context

- Every time on the page came from two guesses about the visitor: a walking pace (4 km/h) and minutes per kind of
  stop ([0005](0005-stop-value-is-viewing-time.md)). Durations, start and end times, the time limit, and which
  stops it left out all depended on them.
- Andrei's review notes said: *"Dont use speed just calculate the route, this is subjective."* The first redesign
  only hid the pace setting. It still timed the route with a fixed pace, and kept a "time available" stepper.
- On 2026-11-01 Andrei asked to *"remove the inference of time"* and to *"Remove the timelimit aswell"*.

## Decision

**The web app plans the shortest walk through every stop chosen, and shows distances only.**

- No time limit, no durations, no start or end time, no minutes per stop. The page shows the total walk, the
  number of stops, and the distance of each leg.
- The settings are where to start (the Portaria or your location) and what to see (galleries only, or
  everything), plus stops skipped or added. Shared links carry `s`, `m` and `x`. Old links' `b` (time limit)
  and `t` (start time) are ignored.
- Must-sees become **stops added** beyond what "what to see" covers. A search result that's already on the route
  shows its stop instead.
- `plan.js` keeps `budgetMin`, `speedKmh` and `dwellMin`, so that it still mirrors `planner.py` and passes the parity
  test ([0009](0009-web-app-plans-in-the-browser.md)). The page passes no budget. When every chosen stop is
  visited, minutes per stop don't change the route, and a single pace doesn't change which order is shortest.
  So the route depends on distances only.
- The command-line tool keeps `--budget`, `--speed`, `--dwell` and `--start-time`. ADR 0005 now applies only there.

## Consequences

- ✅ Nothing on the page is a guess about the visitor. Everyone gets the same route for the same choices.
- ✅ The closing-time problem goes away on the page: it shows no times of day, so no plan can end after closing.
- ⚠️ "Everything" is a long walk: 89 stops and 12.9 km, or 58 stops and 11.8 km without the 31 botanical
  highlights. Visitors with an afternoon choose for themselves: galleries only (19 stops, 7.6 km), skipping stops,
  or adding specific ones. The page no longer picks what fits in their time.
- ⚠️ The page no longer uses the browser solver's budget searches. They stay, still tested, for parity with the
  command line.

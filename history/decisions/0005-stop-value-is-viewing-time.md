# 0005: A stop is worth its viewing minutes

- **Status:** superseded by [0015](0015-no-time-budget-in-the-command-line.md): no route chooses between stops
  anymore
- **Date:** 2026-11-01

## Context

Under a time budget, the solver needs a value per stop to decide what to leave out. The first defaults were
per-kind weights: gallery 10, outdoor work 6, exhibition 6, garden 5, work inside a gallery 4, botanical 2.
The solver maximizes the value collected per minute spent (time at the stop plus walking), so those arbitrary
numbers decided the whole mix:

- A gallery gave 10 points for 20 min and an outdoor work 6 points for 8 min, so outdoor works were worth more
  per minute. A 4-hour route had **no gallery at all** (22 outdoor works), and a 6-hour route had 1 of the 19
  galleries.
- Raising galleries to 15–20 points flipped the result: the 4-hour route became 10 galleries and nothing else.

## Decision

**value(stop) = its time at the stop, in minutes** (at least 1). The objective reads plainly: *spend the most
time with art, then walk the least.*

Every minute of looking counts the same, so geography (the walking overhead) drives the choices. A long visit
spreads its walk over more minutes, so galleries are attractive without crowding everything else out.

Results with the default dwell times (gallery 20 min, outdoor work 8, garden 10):

| Budget | Galleries | Outdoor works | Gardens | Walking |
|---|---|---|---|---|
| 4 h | 6 | 9 | 2 | 27 min of 3h59 |
| 6 h | 10 | 11 | 3 | 40 min of 5h58 |

## Consequences

- ✅ No magic weights, and the rule is easy to explain. One knob (`--dwell KIND=MIN`) sets both how long a kind
  takes and how much it counts.
- ✅ `--must` still overrides everything for the stops a visitor cares most about.
- ⚠️ "Highlights" aren't modeled: every gallery minute counts the same. If visitors want, say, the most famous
  galleries first, per-POI preferences or presets can sit on top of this later.
- ⚠️ The dwell defaults are still guesses (see `docs/vision.md`), and they now matter twice.

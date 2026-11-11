# Session 2026-11-11 #01: How it works, why it's fast, and a route animation

- **Who:** Andrei (owner) + Claude (AI pair)
- **Goal:** Andrei asked how the project works, then why routes appear instantly, and then for an animation that
  makes the site feel like it's calculating.

## What happened

1. **How the project works.** A walk-through of the pipeline: fetch → snapshots → walking graph → distance
   matrix → solver, and the web app (`park.json`, planning in a worker). Checking the repo turned up three
   things:
   - Local `main` was 4 commits behind `origin/main`: the daily refresh's data commits of 2026-11-02, -03, -05 and
     -06. Pulled (fast-forward).
   - **Those refresh commits are noise.** The POIs and the official routes never changed. `data/osm.json` flips
     between two versions that differ only in a few path tags (`surface`, `tracktype`), and no code reads those.
     The likely cause is that the three Overpass mirrors serve slightly different copies of OSM. Each flip makes a
     commit and a Pages deploy. Not fixed yet.
   - **The scheduled refresh starts hours late.** It's set for 06:17 in Brasília, but GitHub ran it between 12:39
     and 16:50. Every run succeeded (2026-11-02 to -10).
2. **"Are all possible paths already calculated?"** No: every change re-plans in the browser. Measured with the
   page's own planner under node on this laptop:

   | Choice | Stops | Plan |
   |---|---|---|
   | Themed gardens | 9 | 0.1 ms |
   | Galleries | 23 | 3 ms |
   | Default (3 categories) | 58 | 37 ms |
   | All 4 categories | 89 | 131 ms |

   - Dijkstra from all 149 POIs takes 8.5 ms, and the results are cached between plans. The solver is nearly all
     the rest.
   - Precomputing is impossible: 89 stops make 2⁸⁹ ≈ 6 × 10²⁶ possible selections.
   - Unticking each of the 58 default stops re-solves the route every time. 6 of the 58 new routes were shorter
     than the old route minus the stop (by 4 to 106 m), and none was longer. The other 52 were exactly as long, but
     4 to 13 legs came in a different order, because many orders tie in length. Unticking one stop can renumber
     stops elsewhere.
3. **"Is the TSP really that fast?"** Yes, at this size.
   - **Exact method:** Held-Karp grows about 2.2× per stop: 1 ms for 12 stops, 28 ms for 16, and an estimated
     50,000 years for 58.
   - **Browser heuristic:** about 1 ms up to 16 stops and 36 ms for 58. It matched the exact answer every time.
   - **CP-SAT:** it proves the 58-stop optimum (11,805 m) in 0.18 s, and the browser found the same route.
   - **Budgets:** the command line's budget routes (`--budget 4h`, `6h`) are not proven optimal within 5 s.
4. **The time budget.** Andrei: *"i tought we removed the time budget, didint we?"* It's gone from the web app
   ([ADR 0010](../decisions/0010-web-app-without-times.md)). The command line still has `--budget`, which is what
   was run above. `plan.js` keeps the option to mirror `planner.py`. Whether the CLI should drop it is open.
5. **The route animation** (Andrei: *"some blinking paths to simulate that we are actually calculating the
   path? could be a fixed animation"*) → [ADR 0014](../decisions/0014-map-shows-the-search-then-the-route.md):
   - **Code:** `web/js/reveal.js` holds the geometry and timing, with no DOM, and is tested under node (7 tests).
     A canvas in `map.js` draws it. `app.js` makes the summary follow along.
   - **What it does:** the search spreads from the start along every path, with a blinking front and a flash at
     the end. Then the route is drawn stop by stop, and the distance counts to the new value. It takes about
     1.3 s. It doesn't replay for the same route, doesn't play behind the picker, and is skipped when the visitor
     asks for less motion.
   - **Tuning:** the wave started with an ease-out, which lit the middle of the park in about 150 ms and then
     barely moved. It now moves at a steady pace, like the real search.
   - **Checked in Chrome (Playwright, screencast frames):**
     - desktop in light mode and a phone in dark mode;
     - first load, a language switch, the picker, rapid taps, "reduce motion" and a GPS start inside the park;
     - the canvas is left empty and every marker shown at the end, with no console errors;
     - 60 fps with the CPU slowed 4×, and one dropped frame at 6×.
   - **Live:** `pages.yml` deployed it on 2026-11-11 (run 43107157804). The first-load, language, picker,
     rapid-tap, reduce-motion and GPS checks pass on the live site too, with no console errors.

## Decisions

- [0014](../decisions/0014-map-shows-the-search-then-the-route.md): the map shows the search, then draws the route.

## Open questions

- Does Andrei like the animation's look and length (about 1.3 s)? `TIMING` in `reveal.js` sets it.
- Should the command line drop `--budget` too, or keep it as its "best route for N hours" mode?
- Keep a route's order stable when unticking a stop makes nothing shorter? Today the re-solve can renumber stops.
- The noisy OSM refresh: commit only changes that matter for routing (walkable ways, `access`/`foot`, geometry), or
  stick to one Overpass mirror?

## Next steps (hand-off)

- [ ] **Andrei's review of the animation**, live at <https://andreixzc.github.io/inhotim-path/>.
- [ ] **Quiet the daily refresh:** ignore OSM changes that routing doesn't use.
- [ ] Decide on the CLI's `--budget` (above).
- Still open from [2026-11-01](2026-11-01-01-kickoff.md):
  - [ ] Andrei's review of the chips and the picker.
  - [ ] A MapTiler key restricted to the site's domain.
  - [ ] Real phones.
  - [ ] PWA / offline.
  - [ ] Live mode.
  - [ ] A production-like environment.
  - [ ] Phase 2: elevation, per-gallery dwell times, multi-day.

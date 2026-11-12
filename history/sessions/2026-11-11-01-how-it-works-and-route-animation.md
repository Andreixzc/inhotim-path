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
   was run above. `plan.js` kept the option to mirror `planner.py`. Andrei then had it removed everywhere (item 6).
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
6. **No time budget in the command line either** (Andrei: *"yes remove the budget from the cli too"*) →
   [ADR 0015](../decisions/0015-no-time-budget-in-the-command-line.md):
   - **Removed from the top down**, in commits that each pass the tests: the `--budget` flag, then the planner's
     budget fields, then CP-SAT's orienteering mode, then the browser's. About 600 lines fewer, tests included.
     `--must` now just adds stops.
   - **The benchmark** now plans each of the 15 mixes of the four categories, with CP-SAT and with five seeds in
     the browser planner, in about 10 s. CP-SAT proved every mix optimal (0.1 to 2.6 s). The browser matched it in
     73 of 75 runs; the other two (80 stops, seeds 1 and 3) walk 1.3 m more, out of 12.4 km.
   - **No route changed on the page:** the browser's walks were identical before and after, in all 75 runs.
   - **README:** the 6-hour figure became the galleries route (23 stops, 8.4 km), and both figures were redrawn
     with distance-only titles.
7. **A sheet to drag on phones.** Andrei, on a Galaxy S22: *"i cant hide the bar where i select the things i want
   to see"* and *"i cant 'drag' the thing to colappse it, only 'clicking' this isnt very intuitive."* →
   [ADR 0016](../decisions/0016-on-phones-the-plan-is-a-sheet-over-the-map.md):
   - **Before:** at 360 × 700, the map had 280 px above a 420 px sheet. The only control was a tap on a faint
     40 × 5 px handle.
   - **Now:** the map fills the screen and the plan is a sheet over it (`web/js/sheet.js`).
     - A finger drags the sheet down to its summary (163 px) and back up. Let go while still moving and it goes
       that way; let go at rest and it settles at the nearer end.
     - Taps still work.
     - The route is re-framed in the part of the map left in view. If the visitor has moved the map, it's panned
       instead.
   - **Checked** in Chrome with real touch input at 360 × 700: the sheet's 22 checks pass in light and dark mode.
     The animation's 10 checks pass at phone and desktop sizes.
   - **A flick that bounced back:** the first version needed 0.4 px per ms, measured from the moves in the last
     100 ms. A 60 px test flick, slowed to 0.3 px per ms by the test harness, didn't count. Now the speed is
     measured over at least the last 100 ms and the threshold is 0.2 px per ms, closer to Android's own sheets
     (they follow any motion at release).
   - **Andrei, on his S22 (2026-11-12):** *"that thing is working properly on drag now"*. He finds the animation
     *"pretty good"* too.
8. **Easier to click a stop or a point** (2026-11-12). Andrei: *"its very dificult to click on the actual atraction
   [...] on mobile is even wrost"* → [ADR 0017](../decisions/0017-a-click-opens-the-nearest-stop-or-point.md):
   - **Measured before:** a dot opened within 4 to 6 px of its center with a mouse, and within 2 to 4 px with a
     finger. A stop opened within 12 px.
   - **A bug:** with a popup open, a click on another dot closed the popup instead of opening the other one.
   - **Now** (`web/js/pick.js`): a click opens the stop or point whose edge is nearest, within 8 px for a mouse and
     20 px for a finger. With a mouse, the dot grows or the stop gets a ring before the click.
     - With a mouse, a dot opens up to 12 to 14 px from its center and a stop up to 20 px.
     - With a finger, a lone dot opens up to 26 px from its center and a stop up to 32 px.
   - **Checked** in Chrome on desktop and at 360 × 700 with touch. The popup now switches between dots and stays
     open on clicks inside it. A click on empty map closes it, and the zoom buttons leave it alone.
9. **Andrei's next idea** (2026-11-12): *"could see himself on the map? like a gps? and also enable him to mark the
   things he saw, so he wouldnt have to see redudnat stuff on the map?"* Seeing yourself already works: the map's
   locate button shows a live dot. Marking stops as seen is the roadmap's live mode. A design was proposed in
   the chat, and Andrei's choices are still to come (see the open questions).

## Decisions

- [0014](../decisions/0014-map-shows-the-search-then-the-route.md): the map shows the search, then draws the route.
- [0015](../decisions/0015-no-time-budget-in-the-command-line.md): no time budget in the command line either.
- [0016](../decisions/0016-on-phones-the-plan-is-a-sheet-over-the-map.md): on phones, the plan is a sheet dragged
  over a full-screen map.
- [0017](../decisions/0017-a-click-opens-the-nearest-stop-or-point.md): a click opens the nearest stop or point
  within reach.

## Open questions

- **Marking stops as seen:**
  - Should seen stops stay on the map, faded with a check, or disappear?
  - Should the GPS mark stops by itself, suggest them, or stay out of it?
  - Should marks last for a two-day visit until cleared, or reset each day?
- The command line still prints estimated times (4 km/h, minutes per kind of stop). Keep them, or show distances
  only, like the web app?
- Keep a route's order stable when unticking a stop makes nothing shorter? Today the re-solve can renumber stops.
- The noisy OSM refresh: commit only changes that matter for routing (walkable ways, `access`/`foot`, geometry), or
  stick to one Overpass mirror?

## Next steps (hand-off)

- [ ] **Seen stops** (live mode, Phase 4), once Andrei has chosen:
  - mark a stop as seen from its popup or the list;
  - re-plan what's left from the last one seen, or from where you are, back to the Portaria;
  - keep the marks on the phone.
- [x] Andrei's review of the animation: *"pretty good"*.
- [x] Andrei tried the sheet on his S22: it drags properly.
- [ ] **Quiet the daily refresh:** ignore OSM changes that routing doesn't use.
- [x] The CLI's `--budget`: removed (ADR 0015).
- Still open from [2026-11-01](2026-11-01-01-kickoff.md):
  - [ ] Andrei's review of the chips and the picker.
  - [ ] A MapTiler key restricted to the site's domain.
  - [ ] Real phones.
  - [ ] PWA / offline.
  - [ ] Live mode.
  - [ ] A production-like environment.
  - [ ] Phase 2: elevation, per-gallery dwell times, multi-day.

# history/: project memory

This folder is the **shared memory** of the project. It records what was done, what was decided
and why, so that any future session (you, a collaborator, or an AI assistant with no prior context)
can pick up exactly where the last one stopped.

Code shows *what* the project is. This folder explains *how it got there* and *what comes next*.

## Layout

| Path | What goes there |
|------|-----------------|
| `sessions/YYYY-MM-DD-NN-slug.md` | One log per working session: goal, what happened, findings, decisions, open questions, next steps. |
| `decisions/NNNN-slug.md` | Lightweight ADRs (Architecture Decision Records): context → decision → consequences. |

## Rules of thumb

1. **Start of a session:** read this file, the latest session log and the decision index below.
2. **End of a session:** write or update the session log, and keep the "Next steps" section current.
   It is the hand-off note for the next session.
3. **Decisions are append-only.** Don't rewrite an old ADR. If a decision changes, add a new ADR
   that *supersedes* the old one and mark the old one's status.
4. Keep entries short and factual. Link to `docs/` for living documentation and to commits/PRs for details.
5. Record dates as absolute dates (`2026-11-01`), never "yesterday" or "last week".

## Index

### Sessions
- [2026-11-01 #01: Kickoff, Phase 1, then the web app](sessions/2026-11-01-01-kickoff.md): idea refinement, data-source research, repo setup, then the whole CLI (fetch + route, CP-SAT solver, CI), then blocked map tiles fixed, a satellite view, a daily data refresh, and the web app (planning in the browser, benchmarked against CP-SAT), live on GitHub Pages, then made minimalist, then without times or a time limit, on the original map, then chosen by the museum's categories (Doug Aitken's gallery counted as one), in the museum's words, and by artist.
- [2026-11-11 #01: How it works, why it's fast, and a route animation](sessions/2026-11-11-01-how-it-works-and-route-animation.md): a walk-through of the project, measurements of how fast the browser plans (and why precomputing is impossible), the noisy daily refresh, then an animation of the search and the route on the map, then no time budget in the command line either, then a sheet to drag on phones, then easier clicks on the map's stops and points.

### Decisions
- [0001: Use the official map's marker feed as the POI source](decisions/0001-official-map-marker-feed-as-poi-source.md)
- [0002: Walking network = OpenStreetMap + official axes SVG](decisions/0002-walking-network-osm-plus-official-axes.md)
- [0003: Python pipeline managed with uv, OR-Tools as solver](decisions/0003-python-uv-ortools.md) (solver part superseded by 0004)
- [0004: CP-SAT circuit model instead of the OR-Tools routing library](decisions/0004-cp-sat-circuit-solver.md) (budget mode removed by 0015)
- [0005: A stop is worth its viewing minutes](decisions/0005-stop-value-is-viewing-time.md) (superseded by 0015)
- [0006: HTML map basemap from OpenFreeMap (MapLibre), not OSM's tile servers](decisions/0006-basemap-openfreemap.md)
- [0007: Keep the data fresh with a daily GitHub Actions refresh](decisions/0007-daily-data-refresh.md)
- [0008: Satellite view from MapTiler, with the user's own key](decisions/0008-satellite-view-maptiler.md)
- [0009: The web app is a static site that plans routes in the browser](decisions/0009-web-app-plans-in-the-browser.md)
- [0010: The web app shows no times and sets no time limit](decisions/0010-web-app-without-times.md) (what to see: see 0011 and 0012; the command line too: 0015)
- [0011: What "galleries" and "everything" cover](decisions/0011-what-galleries-and-everything-cover.md) ("everything" replaced by 0012)
- [0012: Visitors choose what to see by category, and stop by stop in a picker](decisions/0012-choose-what-to-see-by-category.md) (words and artists: see 0013)
- [0013: The museum's words for the categories, and choosing by artist](decisions/0013-inhotim-words-and-choosing-by-artist.md)
- [0014: The map shows the search, then draws the route](decisions/0014-map-shows-the-search-then-the-route.md)
- [0015: No time budget in the command line either](decisions/0015-no-time-budget-in-the-command-line.md)
- [0016: On phones, the plan is a sheet dragged over a full-screen map](decisions/0016-on-phones-the-plan-is-a-sheet-over-the-map.md)
- [0017: A click opens the nearest stop or point within reach](decisions/0017-a-click-opens-the-nearest-stop-or-point.md)

# Roadmap

Checkboxes are updated as work lands. The *why* behind each item lives in [vision.md](vision.md), and the
session-by-session story lives in [`history/`](../history/).

## Phase 0: Research & foundations ✅ (2026-11-01)

- [x] Find a programmatic source for the map data (marker feed, routes SVG, OSM)
- [x] Validate the georeferencing of the official routes against OSM
- [x] Refine the problem: TSP → orienteering → multi-day
- [x] Repo, docs and project memory (`history/`)

## Phase 1: CLI MVP ✅ (2026-11-01)

- [x] Python project scaffold (uv, ruff, pytest, CLI entry point)
- [x] `fetch`: POIs → `data/pois.json`
- [x] `fetch`: official routes SVG → `data/axes.geojson`
- [x] `fetch`: OSM ways + park boundary → `data/osm.json`
- [x] Walking graph (OSM + SVG gap fill, clipped to the park) and POI snapping
- [x] Walking-time matrix
- [x] `route`: TSP over all stops from the reception (58 stops: 14h47, proven optimal)
- [x] `route --budget 4h`: orienteering (CP-SAT; a stop is worth its viewing minutes)
- [x] Filters: `--must`, `--exclude`, `--kinds`, `--botanical`; settings: `--dwell`, `--speed`, `--start-time`
- [x] Outputs: itinerary text, GeoJSON, HTML map
- [x] CI (lint + tests + a CLI smoke run)

## Phase 2: Better estimates

- [ ] Elevation + slope-aware walking times (Tobler)
- [ ] Per-gallery dwell times (from the works inside each gallery)
- [ ] Opening hours / time windows
- [ ] Multi-day plans (`--days 2`)
- [ ] Electric carts as optional faster edges
- [ ] Lunch stop (restaurants)
- [ ] Preferences on top of viewing minutes (e.g. favorite artists, "galleries first")
- [ ] Calibrate the dwell defaults (visitor input, gallery sizes)

## Phase 3: Web app

- [x] Decide how routes are computed on the web: in the browser, exact up to 12 stops, heuristics beyond,
      benchmarked against CP-SAT (ADR 0009)
- [x] `inhotim-path web-data`: the park (POIs + walking network) as one JSON file for the browser
- [x] Mobile-first planner page in `web/`: time available, kinds, must-sees, pace, skip/add stops, Portuguese and
      English, shareable links
- [x] Scheduled data refresh (GitHub Actions cron) + "what's new" diff of the collection (ADR 0007)
- [x] Satellite view on the map, with a MapTiler key (ADR 0008)
- [x] Deploy workflow for GitHub Pages (`pages.yml`), republished after each data refresh
- [x] Live on GitHub Pages: <https://andreixzc.github.io/inhotim-path/>
- [ ] A MapTiler key restricted to the web app's domain (repository variable `MAPTILER_API_KEY`)
- [ ] Try it on real phones: speed of the largest plans, the layout, GPS inside the park
- [ ] Offline-capable PWA (cache the page, `park.json` and the basemap around the park)
- [ ] A production-like environment later on (where to host it, staging before production: to decide)

## Phase 4: Live mode

- [x] GPS "you are here": MapLibre's `GeolocateControl` (HTTPS and the visitor's permission; the position never
      leaves the phone)
- [x] Plan from the current position, starting now, ending at the reception
- [ ] Check off visited stops, automatically within ~25 m of one
- [ ] Re-plan the rest of the visit as you go (keep what's been seen, use the time left)
- [ ] Time-left and closing-time alerts

## Phase 5: Smart extras

- [ ] Crowd/queue heuristics
- [ ] Weather-aware ordering
- [ ] Accessibility mode (avoid steep or unpaved paths)
- [x] Shareable plans (the settings live in the page's URL)

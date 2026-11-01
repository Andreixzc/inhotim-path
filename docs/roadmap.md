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

- [ ] Decide how routes are computed on the web: precomputed vs. API vs. in-browser heuristic (see ADR 0003)
- [ ] Mobile-first map UI (MapLibre, as in the HTML map: ADR 0006), offline-capable PWA
- [ ] Scheduled data refresh (GitHub Actions cron) + "what's new" diff of the collection
- [ ] Deploy (GitHub Pages or Vercel)

## Phase 4: Live mode

- [ ] GPS "you are here" (on-device only)
- [ ] Check off visited stops; re-route on the fly
- [ ] Time-left and closing-time alerts

## Phase 5: Smart extras

- [ ] Crowd/queue heuristics
- [ ] Weather-aware ordering
- [ ] Accessibility mode (avoid steep or unpaved paths)
- [ ] Shareable plans

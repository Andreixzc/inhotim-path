# Roadmap

Checkboxes are updated as work lands. The *why* behind each item lives in [vision.md](vision.md), and the
session-by-session story lives in [`history/`](../history/).

## Phase 0: Research & foundations ✅ (2026-11-01)

- [x] Find a programmatic source for the map data (marker feed, routes SVG, OSM)
- [x] Validate the georeferencing of the official routes against OSM
- [x] Refine the problem: TSP → orienteering → multi-day
- [x] Repo, docs and project memory (`history/`)

## Phase 1: CLI MVP

- [ ] Python project scaffold (uv, ruff, pytest, CLI entry point)
- [ ] `fetch`: POIs → `data/pois.json`
- [ ] `fetch`: official routes SVG → `data/axes.geojson`
- [ ] `fetch`: OSM ways + park boundary → `data/osm.json`
- [ ] Walking graph (OSM + SVG gap fill, clipped to the park) and POI snapping
- [ ] Walking-time matrix
- [ ] `route`: TSP over all stops from the reception
- [ ] `route --budget 4h`: orienteering
- [ ] Filters: `--must`, `--kinds`, `--include-botanical`
- [ ] Outputs: itinerary text, GeoJSON, HTML map
- [ ] CI (lint + tests)

## Phase 2: Better estimates

- [ ] Elevation + slope-aware walking times (Tobler)
- [ ] Per-gallery dwell times (from the works inside each gallery)
- [ ] Opening hours / time windows
- [ ] Multi-day plans (`--days 2`)
- [ ] Electric carts as optional faster edges
- [ ] Lunch stop (restaurants)

## Phase 3: Web app

- [ ] Decide how routes are computed on the web: precomputed vs. API vs. in-browser heuristic (see ADR 0003)
- [ ] Mobile-first map UI (MapLibre or Leaflet), offline-capable PWA
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

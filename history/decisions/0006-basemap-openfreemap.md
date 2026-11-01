# 0006: HTML map basemap from OpenFreeMap (MapLibre), not OSM's tile servers

- **Status:** accepted
- **Date:** 2026-11-01

## Context

The `--html` map used Leaflet with raster tiles from `tile.openstreetmap.org`. The first time it was opened
(straight from the file), every tile was OSM's block tile: *"App is not following the tile usage policy of
OpenStreetMap's volunteer-run servers"*.

- OSM's [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) expects browsers to send a
  valid `Referer`. A page opened from a `file://` URL sends none, and a referrer meta tag doesn't change that.
  OSM's forum calls this case unsolved
  ([thread](https://community.openstreetmap.org/t/error-403-when-using-local-files-referer-missing-can-i-use-user-agent-and-what-should-it-contain/142447)).
- The map is a standalone file, and opening it directly is its main use. Phase 3 also wants offline use, which
  OSM's policy forbids on its servers.

Options checked on 2026-11-01:

| Option | Why not |
|---|---|
| Serve the page on `localhost`, so a `Referer` is sent | Double-clicking the file would still break, and it adds a server to a CLI. |
| CARTO basemaps | An API key is now required: keyless requests get an "API key required" watermark. |
| Stadia Maps, MapTiler, Thunderforest | An API key (or a registered domain) is required. |

## Decision

Draw the basemap with **MapLibre GL JS** (5.24.0 from cdnjs, pinned with SRI) on **OpenFreeMap**'s vector tiles
(`liberty` style).

- OpenFreeMap needs no API key and no registration. It has no usage limits and allows commercial use.
  Its attribution, "OpenFreeMap © OpenMapTiles Data from OpenStreetMap", is shown by MapLibre automatically.
- The style, tiles, fonts and sprites are served with `Access-Control-Allow-Origin: *`, so a `file://` page can
  load them. Checked in Chrome 156 from a local file, at desktop and phone sizes.

## Consequences

- ✅ The map works when the file is opened directly, with no key and no server.
- ✅ The route draws under the basemap's labels, and the gardens, lakes and galleries are named on the map. If the
  basemap can't load, the route still draws on a plain background.
- ✅ A head start for Phase 3. MapLibre is the likely library for the web UI, and OpenFreeMap allows small offline
  downloads (at most 3,000 tiles or 50 MB) and self-hosting.
- ⚠️ MapLibre needs WebGL, which every current browser has. The page still needs the internet for MapLibre and the
  tiles, as it did with Leaflet.
- ⚠️ OpenFreeMap is a single donation-funded service with no SLA. If it goes away, change the style URL in
  `export.py` or self-host the tiles.
- Don't point the page at `tile.openstreetmap.org` again. `tests/test_export.py` checks for it.

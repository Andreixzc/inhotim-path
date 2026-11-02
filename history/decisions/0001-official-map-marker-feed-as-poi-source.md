# 0001: Use the official map's marker feed as the POI source

- **Status:** accepted; what counts as a gallery is refined by [0011](0011-what-galleries-and-everything-cover.md)
- **Date:** 2026-11-01

## Context

The route planner needs an up-to-date list of attractions (galleries, outdoor works, gardens…)
**with coordinates**. Inhotim adds, removes and rotates works, so a hand-curated list would go stale.

Options investigated during the kickoff research spike (details in `docs/data-sources.md`):

| Option | Coordinates? | Notes |
|--------|:---:|-------|
| Scrape the `/mapa/` HTML | ❌ | Only filter lists (names + ids). Markers are loaded by JS. |
| WP REST `wp/v2/it_map_point` | ❌ | 166 points, but the ACF fields (where coordinates live) are not exposed. |
| Mobile API `inhotim/mobile/map/points-of-interest` | ❌ | 209 POIs with names, descriptions and thumbnails. |
| **`admin-ajax.php?action=get_markers`** | ✅ | What the website's own map calls. 262 entries / 150 unique ids, with lat/lng, category, route color, artists, `main_view`, "what's new" flags. |
| Manual list / OSM `tourism=artwork` | partial | Incomplete, and wouldn't track changes. |

## Decision

Use `get_markers` as the primary POI source. Normalize and deduplicate it into a versioned snapshot
(`data/pois.json`). Keep the mobile API as an optional enrichment source for later (descriptions, photos
shown via links, never re-hosted).

## Consequences

- ✅ Coordinates and categories come straight from the source of truth, and the snapshot updates when the official map does.
- ✅ Snapshots committed to git give offline use plus a free changelog of the collection ("what's new" diffs).
- ⚠️ It's an **undocumented internal endpoint** and can change without notice. Mitigation: validate the
  schema, fail loudly, and keep the last good snapshot.
- ⚠️ Quirks to handle: duplicated ids, HTML inside fields, `main_view=false` for works *inside* galleries,
  and events with off-site coordinates.

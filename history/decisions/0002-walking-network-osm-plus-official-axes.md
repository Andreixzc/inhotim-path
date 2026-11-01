# 0002: Walking network = OpenStreetMap + official axes SVG

- **Status:** accepted
- **Date:** 2026-11-01

## Context

Routes must follow real paths. Straight-line distances are badly wrong in a hilly park with winding
paths and lakes. We need a walkable, connected graph that reaches every POI.

Two candidate sources, compared visually during the research spike (`docs/img/network-comparison.png`):

- **OpenStreetMap** (Overpass API): a real topological network with junctions, the entrance and parking, plus the
  park boundary (relation `5418784`). But some official routes have no OSM counterpart, and roads
  outside the park could create bogus shortcuts.
- **Official axes SVG** (the colored "eixos" overlay of the website map): the routes visitors actually follow,
  georeferenced from bounds hardcoded in the theme JS. It lines up with OSM within a few meters, but it's a
  *drawing*: disconnected strokes, no junction topology, and it doesn't reach the parking/shop area.

## Decision

Fuse both:

1. Use OSM walkable ways (`footway`, `path`, `pedestrian`, `steps`, `service`, `track`, …) **clipped to the
   park boundary** as the base graph.
2. Add the parts of the SVG axes that are farther than a tolerance from any OSM way ("gap fill"), and connect
   their loose ends to the nearest node within a snapping radius.
3. Snap each POI to its nearest edge with a short connector edge. Flag POIs that are too far from any path.

## Consequences

- ✅ Better coverage than either source alone, and each source sanity-checks the other.
- ⚠️ Tolerances (gap distance, snap radius) need tuning and tests.
- ⚠️ If Inhotim redraws the SVG or moves its bounds, the georeferencing must follow. Mitigation: read the SVG
  URL from the page and parse the bounds from the theme JS, with the known values as fallback.
- ⚖️ OSM data is ODbL: attribution is required in docs and in any rendered output.

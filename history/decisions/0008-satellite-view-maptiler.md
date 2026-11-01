# 0008: Satellite view from MapTiler, with the user's own key

- **Status:** accepted
- **Date:** 2026-11-01

## Context

Andrei asked for a satellite view on the map. What was found on 2026-11-01:

- **Esri World Imagery:** this is the tile URL most Leaflet examples use without a key. The layer is licensed
  under the Esri Master License Agreement. Esri's terms summary (April 2025) only covers use "with Esri software"
  and adds: "If you do not have Esri software, you must purchase an ArcGIS Online subscription." ArcGIS Location
  Platform has a free tier (2M basemap tiles a month), but it needs an API key, and usage beyond that is billed.
- **MapTiler Cloud, free plan:**
  - no credit card;
  - 5,000 map sessions and 100,000 API requests a month;
  - meant for personal or non-commercial use;
  - the MapTiler logo must be shown on the map;
  - over the quota, the service pauses until the next month instead of billing.
- **Sentinel-2 cloudless (EOX):** no key needed, but 10 m pixels are far too coarse at the scale of a park.
- No source was found with sharp imagery, no key, and terms that allow this use.

## Decision

The satellite view uses **MapTiler's `satellite-v2` raster tiles**, with a key the user provides:
`route --satellite-key KEY`, or the `MAPTILER_API_KEY` environment variable.

- **Without a key:** the page has no satellite button and never contacts MapTiler.
- **With a key:** a "Satellite" button loads the imagery when first pressed. The imagery goes under the route and
  the place names, and the MapTiler logo shows while it's on.
- **Bad key:** the tile index fails, so the button disables itself and explains why. The rest of the map keeps
  working.

## Consequences

- ✅ Free for a hobby project, with no card and no surprise bills: the quota pauses instead.
- ✅ The same code can serve the future web app, with a key restricted to the app's domain in MapTiler's dashboard.
- ⚠️ The key is written into the HTML page. A page opened from a file has no usable origin, so a domain-restricted
  key won't work there. Keep such pages private, or use a separate key for them.
- ⚠️ A 512 px raster tile counts as 4 requests, so the free 100,000 requests are on the order of a thousand
  satellite views a month. That's plenty for planning, but a popular web app would need a paid plan or another
  source.
- ⚠️ Not yet checked with a real key. The button, the lazy loading and the bad-key path were checked in Chrome; the
  imagery itself wasn't.
- ➡️ Switching to Esri (an ArcGIS Location Platform key) means changing the source URL in `export.py`. Nothing else
  changes.

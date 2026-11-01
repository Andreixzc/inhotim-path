"""Render a plan: terminal itinerary, GeoJSON and a standalone HTML map (MapLibre GL)."""

from __future__ import annotations

import html
import json
from datetime import date, datetime, time, timedelta
from typing import Any

from inhotim_path.models import PoiKind
from inhotim_path.planner import Plan, display_name

ATTRIBUTION = (
    "Paths © OpenStreetMap contributors (ODbL) · Points and official routes from Instituto "
    "Inhotim's public map · Not affiliated with Inhotim"
)
KIND_COLOR = {
    PoiKind.GALLERY: "#d62728",
    PoiKind.OUTDOOR_WORK: "#2ca02c",
    PoiKind.GARDEN: "#9467bd",
    PoiKind.BOTANICAL: "#8c8c00",
    PoiKind.EXHIBITION: "#ff7f0e",
    PoiKind.WORK_IN_GALLERY: "#e377c2",
    PoiKind.SERVICE: "#333333",
    PoiKind.EVENT: "#17becf",
    PoiKind.OTHER: "#7f7f7f",
}
LONG_DAY_S = 8 * 3600


def duration(seconds: float) -> str:
    """1h05, 45 min."""
    hours, minutes = divmod(round(seconds / 60), 60)
    return f"{hours}h{minutes:02d}" if hours else f"{minutes} min"


def clock(seconds: int, start: time | None) -> str:
    """Time of day if a start time is given ("13:05", "00:40 +1d"), else elapsed ("3:25")."""
    if start is None:
        hours, minutes = divmod(round(seconds / 60), 60)
        return f"{hours}:{minutes:02d}"
    day0 = date(2000, 1, 1)
    moment = datetime.combine(day0, start) + timedelta(seconds=seconds)
    extra_days = (moment.date() - day0).days
    return moment.strftime("%H:%M") + (f" +{extra_days}d" if extra_days else "")


def summary(plan: Plan) -> str:
    return (
        f"{len(plan.stops)} stops · {plan.walk_m / 1000:.1f} km walking ({duration(plan.walk_s)})"
        f" + {duration(plan.dwell_s)} at stops = {duration(plan.total_s)}"
    )


def format_itinerary(plan: Plan, start_time: time | None = None) -> str:
    request = plan.request
    dwell = ", ".join(f"{kind.value} {request.dwell_min.get(kind, 0):g}m" for kind in request.kinds)
    lines = [
        f"Inhotim route: {summary(plan)}",
        f"walking speed {request.speed_kmh:g} km/h · time at each stop: {dwell}",
    ]
    if request.budget_min is not None:
        lines.append(
            f"time budget {duration(request.budget_min * 60)} · {len(plan.skipped)} stops left out"
        )
    if plan.optimal:
        lines.append("route quality: proven optimal")
    else:
        lines.append(
            f"route quality: best found in {request.time_limit_s:g} s, not proven optimal "
            "(--time-limit searches longer)"
        )
    lines += ["", f"{'#':>3}  {'time':>9}  {'stop':<46}  {'kind':<13}  walk from previous"]
    for index, visit in enumerate(plan.visits):
        walk = "" if index == 0 else f"{visit.walk_m:,.0f} m · {duration(visit.walk_s)}"
        name = display_name(visit.poi)
        name = name if len(name) <= 46 else name[:45] + "…"
        lines.append(
            f"{index:>3}  {clock(visit.arrive_s, start_time):>9}  {name:<46}  "
            f"{visit.poi.kind.value:<13}  {walk}"
        )
    if plan.skipped:
        ranked = sorted(plan.skipped, key=lambda p: (-request.dwell_min.get(p.kind, 0), p.name))
        names = ", ".join(display_name(p) for p in ranked[:8])
        more = f" (+{len(ranked) - 8} more)" if len(ranked) > 8 else ""
        lines += ["", f"Left out ({len(ranked)}): {names}{more}"]
    if plan.unreachable:
        names = ", ".join(display_name(p) for p in plan.unreachable)
        lines += ["", f"Unreachable (too far from any known path): {names}"]
    if request.budget_min is None and plan.total_s > LONG_DAY_S:
        lines += [
            "",
            f"Seeing all of it takes {duration(plan.total_s)}, more than a single visiting day.",
            "Try --budget 6h for the best route that fits your time.",
        ]
    return "\n".join(lines)


def to_geojson(plan: Plan, start_time: time | None = None) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for index, leg in enumerate(plan.legs):
        origin, target = plan.visits[index], plan.visits[index + 1]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "type": "leg",
                    "leg": index + 1,
                    "from": display_name(origin.poi),
                    "to": display_name(target.poi),
                    "walk_m": round(target.walk_m),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(lng, 7), round(lat, 7)] for lat, lng in leg],
                },
            }
        )
    for index, visit in enumerate(plan.visits[:-1]):  # the final return is the same place
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "type": "stop",
                    "order": index,
                    "id": visit.poi.id,
                    "name": display_name(visit.poi),
                    "kind": visit.poi.kind.value,
                    "time": clock(visit.arrive_s, start_time),
                    "arrive_s": visit.arrive_s,
                    "dwell_s": visit.dwell_s,
                    "url": visit.poi.url,
                },
                "geometry": {"type": "Point", "coordinates": [visit.poi.lng, visit.poi.lat]},
            }
        )
    return {
        "type": "FeatureCollection",
        "summary": summary(plan),
        "attribution": ATTRIBUTION,
        "features": features,
    }


def to_html(plan: Plan, start_time: time | None = None, *, satellite_key: str | None = None) -> str:
    """A standalone map page. With a MapTiler ``satellite_key`` it also gets a satellite view."""
    data = json.dumps(to_geojson(plan, start_time), ensure_ascii=False).replace("</", "<\\/")
    colors = json.dumps({kind.value: color for kind, color in KIND_COLOR.items()})
    key = json.dumps(satellite_key).replace("</", "<\\/")
    return (
        _HTML_TEMPLATE.replace("__SUMMARY__", html.escape(summary(plan)))
        .replace("__ATTRIBUTION__", html.escape(ATTRIBUTION))
        .replace("__COLORS__", colors)
        .replace("__SATELLITE_KEY__", key)
        .replace("__DATA__", data)
    )


# The basemap is OpenFreeMap's vector tiles drawn by MapLibre GL: free, no API key, and served
# with CORS, so the page also works when opened straight from a file. OpenStreetMap's own tile
# servers block that case (a local file sends no Referer header), and their policy discourages
# apps relying on them. See history/decisions/0006-basemap-openfreemap.md.
_HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inhotim route</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css"
  integrity="sha512-KIMsMWIdnoG9OwZa+oaIafmbDonqck1UCmq+/zcUi2aaZ97N9QE6TqpTM+n36EO40HGh64hU/375zxtjx7WTyQ=="
  crossorigin="anonymous">
<style>
  html, body, #map { height: 100%; margin: 0; }
  body { font: 14px/1.4 system-ui, sans-serif; }
  .panel { position: absolute; top: 10px; left: 10px; right: 50px; z-index: 1; max-width: 560px;
           background: #fff; padding: 8px 12px; border-radius: 8px;
           box-shadow: 0 1px 5px rgba(0, 0, 0, .3); }
  .panel small { color: #555; }
  .stop { width: 24px; height: 24px; border-radius: 50%; color: #fff; font-weight: 600;
          font-size: 11px; display: flex; align-items: center; justify-content: center;
          border: 2px solid #fff; box-shadow: 0 0 3px rgba(0, 0, 0, .5); cursor: pointer; }
  .maplibregl-ctrl-group button.layer-toggle { width: auto; padding: 0 10px;
                                               font: 600 12px system-ui; }
  .maptiler-logo { position: absolute; left: 10px; bottom: 10px; z-index: 1; display: none; }
</style>
</head>
<body>
<div id="map"></div>
<div class="panel"><b>Inhotim route</b> · __SUMMARY__<br><small>__ATTRIBUTION__</small></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js"
  integrity="sha512-rOFgoUgWaVi69JW1dzBu6PWF9xKW9rxYfY5u2SexFABHhWk0qUWkJoWNz4UuZRMvSXsNZG66+tU5B+HlwWF5kA=="
  crossorigin="anonymous"></script>
<script>
const data = __DATA__;
const colors = __COLORS__;
const basemap = "https://tiles.openfreemap.org/styles/liberty";
const satelliteKey = __SATELLITE_KEY__;
// If the basemap can't load, the route still draws, on a plain background.
const plain = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eceee6" } }],
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const bounds = new maplibregl.LngLatBounds();
for (const f of data.features) {
  const g = f.geometry;
  for (const c of g.type === "Point" ? [g.coordinates] : g.coordinates) bounds.extend(c);
}

// Satellite imagery is optional: MapTiler's tiles need the user's own key (--satellite-key).
// Nothing is requested from MapTiler until the button is first pressed.
class SatelliteToggle {
  onAdd(map) {
    this.map = map;
    this.visible = false;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "layer-toggle";
    this.button.textContent = "Satellite";
    this.button.addEventListener("click", () => this.toggle());
    this.box = document.createElement("div");
    this.box.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.box.append(this.button);
    return this.box;
  }

  onRemove() {
    this.box.remove();
  }

  toggle() {
    const map = this.map;
    if (!map.getSource("satellite")) {
      const key = encodeURIComponent(satelliteKey);
      map.addSource("satellite", {
        type: "raster",
        url: `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${key}`,
        tileSize: 512,
      });
      map.addLayer({ id: "satellite", type: "raster", source: "satellite" }, "legs-casing");
      // A bad key fails on the tile index, not on a single tile: give up and say so.
      map.on("error", (e) => e.sourceId === "satellite" && !e.tile && this.fail());
      this.logo = document.createElement("a");
      this.logo.className = "maptiler-logo";
      this.logo.href = "https://www.maptiler.com/";
      this.logo.target = "_blank";
      this.logo.rel = "noopener";
      this.logo.innerHTML =
        '<img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" height="24">';
      map.getContainer().append(this.logo);
    }
    this.visible = !this.visible;
    map.setLayoutProperty("satellite", "visibility", this.visible ? "visible" : "none");
    this.button.textContent = this.visible ? "Map" : "Satellite";
    this.logo.style.display = this.visible ? "block" : "none";
  }

  fail() {
    if (this.visible) this.toggle();
    this.button.disabled = true;
    this.button.title = "Satellite imagery unavailable: check the MapTiler key";
  }
}

function draw(style) {
  const panelHeight = document.querySelector(".panel").offsetHeight;
  const map = new maplibregl.Map({
    container: "map",
    style,
    bounds,
    fitBoundsOptions: { padding: { top: panelHeight + 24, right: 40, bottom: 40, left: 40 } },
    maxZoom: 19,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  map.on("load", () => {
    map.addSource("route", { type: "geojson", data });
    const legs = ["==", ["get", "type"], "leg"];
    const layout = { "line-join": "round", "line-cap": "round" };
    // Below the basemap's labels, so place names stay readable over the route.
    const labels = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    const line = (id, paint) =>
      map.addLayer({ id, type: "line", source: "route", filter: legs, layout, paint }, labels);
    line("legs-casing", { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.8 });
    line("legs", { "line-color": "#e4572e", "line-width": 4 });
    if (satelliteKey) map.addControl(new SatelliteToggle());
  });
  for (const f of data.features.filter((f) => f.properties.type === "stop")) {
    const p = f.properties;
    const marker = document.createElement("div");
    marker.className = "stop";
    marker.style.background = colors[p.kind] || "#555";
    marker.textContent = p.order;
    const link = /^https?:/i.test(p.url || "")
      ? `<br><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">official page</a>`
      : "";
    const title = `<b>${p.order}. ${escapeHtml(p.name)}</b>`;
    const details = `${escapeHtml(p.kind)} · ${escapeHtml(p.time)}`;
    new maplibregl.Marker({ element: marker })
      .setLngLat(f.geometry.coordinates)
      .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(`${title}<br>${details}${link}`))
      .addTo(map);
  }
}

const timeout = AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined;
fetch(basemap, { signal: timeout })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
  .catch(() => plain)
  .then(draw);
</script>
</body>
</html>
"""

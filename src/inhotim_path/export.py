"""Render a plan: terminal itinerary, GeoJSON and a standalone HTML map (Leaflet)."""

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


def to_html(plan: Plan, start_time: time | None = None) -> str:
    data = json.dumps(to_geojson(plan, start_time), ensure_ascii=False).replace("</", "<\\/")
    colors = json.dumps({kind.value: color for kind, color in KIND_COLOR.items()})
    return (
        _HTML_TEMPLATE.replace("__SUMMARY__", html.escape(summary(plan)))
        .replace("__ATTRIBUTION__", html.escape(ATTRIBUTION))
        .replace("__COLORS__", colors)
        .replace("__DATA__", data)
    )


_HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inhotim route</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
  html, body, #map { height: 100%; margin: 0; }
  body { font: 14px/1.4 system-ui, sans-serif; }
  .panel { position: absolute; top: 10px; left: 54px; right: 10px; z-index: 1000; max-width: 560px;
           background: #fff; padding: 8px 12px; border-radius: 8px;
           box-shadow: 0 1px 5px rgba(0, 0, 0, .3); }
  .panel small { color: #555; }
  .stop { width: 24px; height: 24px; border-radius: 50%; color: #fff; font-weight: 600;
          font-size: 11px; display: flex; align-items: center; justify-content: center;
          border: 2px solid #fff; box-shadow: 0 0 3px rgba(0, 0, 0, .5); }
</style>
</head>
<body>
<div id="map"></div>
<div class="panel"><b>Inhotim route</b> · __SUMMARY__<br><small>__ATTRIBUTION__</small></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
const data = __DATA__;
const colors = __COLORS__;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const map = L.map("map");
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const legs = L.geoJSON(data, {
  filter: (f) => f.properties.type === "leg",
  style: { color: "#e4572e", weight: 4, opacity: 0.85 },
}).addTo(map);
for (const f of data.features.filter((f) => f.properties.type === "stop")) {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const icon = L.divIcon({
    className: "",
    html: `<div class="stop" style="background:${colors[p.kind] || "#555"}">${p.order}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  const link = p.url
    ? `<br><a href="${encodeURI(p.url)}" target="_blank" rel="noopener">official page</a>`
    : "";
  const title = `<b>${p.order}. ${escapeHtml(p.name)}</b>`;
  const details = `${escapeHtml(p.kind)} · ${escapeHtml(p.time)}`;
  L.marker([lat, lng], { icon }).addTo(map).bindPopup(`${title}<br>${details}${link}`);
}
map.fitBounds(legs.getBounds(), { padding: [24, 24] });
</script>
</body>
</html>
"""

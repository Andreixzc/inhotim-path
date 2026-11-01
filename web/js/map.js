// The map: OpenFreeMap's quiet basemaps drawn by MapLibre GL (ADR 0006), the planned route with
// numbered stops, the park's other points as grey dots, the visitor's position, and optional
// satellite imagery from MapTiler (ADR 0008). Uses the global `maplibregl` from index.html.

import { t } from "./i18n.js";

const DARK = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
// Grey basemaps, so the route is what stands out.
const BASEMAP = `https://tiles.openfreemap.org/styles/${DARK ? "dark" : "positron"}`;
// If the basemap can't load, the route still draws, on a plain background.
const PLAIN = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": DARK ? "#181c19" : "#eff0ec" },
    },
  ],
};
const EMPTY = { type: "FeatureCollection", features: [] };
// OpenFreeMap's styles credit OpenStreetMap themselves; the plain fallback needs it for the paths.
const OSM_CREDIT =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">' +
  "© OpenStreetMap</a>";

export const FLAG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" ' +
  'd="M5 21V4h9l.4 2H20v10h-7l-.4-2H7v7z"/></svg>';

/** A color from the page's palette (style.css), so the map follows light and dark mode. */
function palette(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Room around a route when framing it: clear of the controls, the credits and the sheet. */
function fitPadding() {
  return matchMedia("(max-width: 899px)").matches
    ? { top: 24, right: 60, bottom: 64, left: 24 }
    : { top: 48, right: 64, bottom: 48, left: 48 };
}

async function loadStyle() {
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined;
    const response = await fetch(BASEMAP, { signal });
    if (!response.ok) throw new Error(response.statusText);
    return await response.json();
  } catch {
    return PLAIN;
  }
}

export class RouteMap {
  /**
   * @param {HTMLElement} container
   * @param {{pois: object[], satelliteKey: string | null}} options
   */
  static async create(container, options) {
    const routeMap = new RouteMap(container, await loadStyle(), options);
    await new Promise((resolve) => routeMap.map.once("load", resolve));
    routeMap.setup();
    return routeMap;
  }

  constructor(container, style, { pois, satelliteKey }) {
    const bounds = new maplibregl.LngLatBounds();
    for (const poi of pois) if (poi.node !== null) bounds.extend([poi.lng, poi.lat]);
    this.map = new maplibregl.Map({
      container,
      style,
      bounds,
      fitBoundsOptions: { padding: 24 },
      maxZoom: 19,
      attributionControl: false,
    });
    this.parkBounds = bounds;
    this.markers = [];
    this.popup = new maplibregl.Popup({ offset: 16, maxWidth: "280px", focusAfterOpen: false });
    /** Set by the page: what to show in a popup, what a stop is called, what a pick does. */
    this.describe = () => document.createElement("div");
    this.nameOf = (poi) => poi.name;
    this.onPick = () => {};

    // Short credits on the map (the sheet's footer has the full ones), so they don't hide it.
    this.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: style === PLAIN ? OSM_CREDIT : undefined,
      }),
    );
    // Zoom buttons only where there's no pinching.
    if (matchMedia("(pointer: fine)").matches) {
      this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    }
    this.map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
    );
    if (satelliteKey) {
      this.satellite = new SatelliteToggle(satelliteKey);
      this.map.addControl(this.satellite);
    }
  }

  setup() {
    const map = this.map;
    map.addSource("legs", { type: "geojson", data: EMPTY });
    map.addSource("pois", { type: "geojson", data: EMPTY });
    // Above the basemap's paths and areas but below its labels, so place names stay readable.
    // (Some styles put a label before the roads: start looking after the last line or area.)
    const layers = map.getStyle().layers;
    const shapes = layers.findLastIndex((layer) => layer.type === "line" || layer.type === "fill");
    const labels = layers.slice(shapes + 1).find((layer) => layer.type === "symbol")?.id;
    const layout = { "line-join": "round", "line-cap": "round" };
    const background = palette("--bg", "#ffffff");
    map.addLayer(
      {
        id: "legs-casing",
        type: "line",
        source: "legs",
        layout,
        paint: { "line-color": background, "line-width": 8, "line-opacity": 0.9 },
      },
      labels,
    );
    map.addLayer(
      {
        id: "legs",
        type: "line",
        source: "legs",
        layout,
        paint: { "line-color": palette("--accent", "#0d6b47"), "line-width": 4.5 },
      },
      labels,
    );
    map.addLayer({
      id: "pois",
      type: "circle",
      source: "pois",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 6],
        "circle-color": DARK ? "#7d857f" : "#9aa29c",
        "circle-stroke-color": background,
        "circle-stroke-width": 1.5,
      },
    });
    map.on("click", "pois", (event) => {
      const feature = event.features[0];
      this.open(feature.geometry.coordinates, feature.properties.id, null);
    });
    map.on("mouseenter", "pois", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "pois", () => (map.getCanvas().style.cursor = ""));
  }

  /** Draw a plan: its walks, a numbered marker per stop, and the other points as dots. */
  show(plan, others) {
    this.popup.remove();
    this.markers.forEach((marker) => marker.remove());
    this.markers = [];
    this.map.getSource("legs").setData({
      type: "FeatureCollection",
      features: plan.legs.map((coordinates) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      })),
    });
    this.map.getSource("pois").setData({
      type: "FeatureCollection",
      features: others.map((poi) => ({
        type: "Feature",
        properties: { id: poi.id },
        geometry: { type: "Point", coordinates: [poi.lng, poi.lat] },
      })),
    });
    const last = plan.visits.length - 1;
    const loop = plan.visits[0]?.poi && plan.visits[0].poi.id === plan.visits[last].poi?.id;
    plan.visits.forEach((visit, index) => {
      if (index === last && loop) return; // one marker for a start that is also the finish
      const element = document.createElement("div");
      const ends = index === 0 || index === last;
      element.className = ends ? "marker marker--end" : "marker";
      element.tabIndex = 0;
      element.setAttribute("role", "button");
      if (ends) {
        element.innerHTML = FLAG;
        const label = index === 0 ? (visit.poi ? t("start") : t("youAreHere")) : t("finish");
        element.setAttribute(
          "aria-label",
          visit.poi ? `${label}: ${this.nameOf(visit.poi)}` : label,
        );
      } else {
        element.textContent = String(index);
        element.setAttribute("aria-label", `${index}. ${this.nameOf(visit.poi)}`);
      }
      const pick = (event) => {
        event.stopPropagation();
        this.open(visit.lnglat, visit.poi?.id ?? null, index);
        this.onPick(index);
      };
      element.addEventListener("click", pick);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") pick(event);
      });
      this.markers.push(new maplibregl.Marker({ element }).setLngLat(visit.lnglat).addTo(this.map));
    });
  }

  /** Show the popup for a POI (or the start position) at `lnglat`; `index` is its stop number. */
  open(lnglat, poiId, index) {
    this.popup.setLngLat(lnglat).setDOMContent(this.describe(poiId, index)).addTo(this.map);
  }

  close() {
    this.popup.remove();
  }

  /** Frame the whole route, or the park when there's no route. */
  fit(plan) {
    const bounds = new maplibregl.LngLatBounds();
    for (const leg of plan?.legs ?? []) for (const point of leg) bounds.extend(point);
    this.map.fitBounds(bounds.isEmpty() ? this.parkBounds : bounds, {
      padding: fitPadding(),
      maxZoom: 17,
      duration: 500,
    });
  }

  focus(lnglat) {
    this.map.easeTo({ center: lnglat, zoom: Math.max(this.map.getZoom(), 16), duration: 500 });
  }

  clear() {
    this.show({ legs: [], visits: [] }, []);
  }

  /** Labels made by this module follow the page's language. */
  translate() {
    this.satellite?.translate();
  }

  resize() {
    this.map.resize();
  }
}

// Satellite imagery is optional: MapTiler's tiles need a key (`web-data --satellite-key`).
// Nothing is requested from MapTiler until the button is first pressed.
class SatelliteToggle {
  constructor(key) {
    this.key = key;
    this.visible = false;
  }

  onAdd(map) {
    this.map = map;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "layer-toggle";
    this.button.addEventListener("click", () => this.toggle());
    this.box = document.createElement("div");
    this.box.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.box.append(this.button);
    this.translate();
    return this.box;
  }

  onRemove() {
    this.box.remove();
  }

  translate() {
    this.button.textContent = this.visible ? t("map") : t("satellite");
    if (this.button.disabled) this.button.title = t("satelliteUnavailable");
  }

  toggle() {
    const map = this.map;
    if (!map.getSource("satellite")) {
      const key = encodeURIComponent(this.key);
      map.addSource("satellite", {
        type: "raster",
        url: `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${key}`,
        tileSize: 512,
      });
      map.addLayer({ id: "satellite", type: "raster", source: "satellite" }, "legs-casing");
      // A bad key fails on the tile index, not on a single tile: give up and say so.
      map.on("error", (event) => event.sourceId === "satellite" && !event.tile && this.fail());
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
    this.logo.style.display = this.visible ? "block" : "none";
    this.translate();
  }

  fail() {
    if (this.visible) this.toggle();
    this.button.disabled = true;
    this.translate();
  }
}

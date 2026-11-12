// The map: OpenFreeMap's basemap drawn by MapLibre GL (ADR 0006), the planned route with numbered
// stops, the park's other points, the visitor's position, and optional satellite imagery from
// MapTiler (ADR 0008). Uses the global `maplibregl` from the script tag in index.html.
//
// The map looks the same in light and dark mode: the page's dark theme stops at its edge.
//
// A new route can play a short animation first (ADR 0014): the search spreading along the paths,
// then the route drawn from the start. It's drawn on a canvas above the map, which hands over to the
// map's own layers at the end. Not for visitors who ask their system for less motion.
//
// A click or a tap opens the stop or point nearest to it, within a reach (pick.js, ADR 0017).

import { t } from "./i18n.js";
import { REACH, nearest, reachFor } from "./pick.js";
import {
  FINISHED,
  HEAD,
  flicker,
  frame,
  paths as networkPaths,
  reached,
  routeLine,
  slice,
  wave,
} from "./reveal.js";

const BASEMAP = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_COLOR = "#e4572e";
/** The search wave's blinking front: a lighter orange than the route. */
const FRONT_COLOR = "#ff8f4a";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The dots for points off the route: radius 3 px at zoom 14 to 6 px at zoom 17, 1 px rim. */
const DOT = { zoom: [14, 17], radius: [3, 6], rim: 1 };
/** How big a dot is on screen (px), rim included, at `zoom`. */
function dotRadius(zoom) {
  const [low, high] = DOT.zoom;
  const share = Math.min(Math.max((zoom - low) / (high - low), 0), 1);
  return DOT.radius[0] + share * (DOT.radius[1] - DOT.radius[0]) + DOT.rim;
}
/** The dot a click would open, under the mouse: bigger and solid. */
const NEAR = ["boolean", ["feature-state", "near"], false];
// If the basemap can't load, the route still draws, on a plain background.
const PLAIN = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eceee6" } }],
};
const EMPTY = { type: "FeatureCollection", features: [] };
// OpenFreeMap's style credits OpenStreetMap itself; the plain fallback needs it for the paths.
const OSM_CREDIT =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">' +
  "© OpenStreetMap</a>";

/** The same colors as the command line's map (src/inhotim_path/export.py). */
export const KIND_COLOR = {
  gallery: "#d62728",
  outdoor_work: "#2ca02c",
  garden: "#9467bd",
  botanical: "#8c8c00",
  exhibition: "#ff7f0e",
  work_in_gallery: "#e377c2",
  service: "#333333",
  event: "#17becf",
  other: "#7f7f7f",
};

export const FLAG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" ' +
  'd="M5 21V4h9l.4 2H20v10h-7l-.4-2H7v7z"/></svg>';
/** The tick on a stop already seen (ADR 0018), on the map and in the list. */
export const CHECK =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="none" ' +
  'stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" ' +
  'd="M5.5 12.5l4 4L18.5 7.5"/></svg>';

/**
 * Room around a framed route: clear of the map's controls and, on phones, of the sheet over the
 * map's bottom (`sheet` px) and the credits just above it, leaving at least 100 px for the route.
 */
function fitPadding(sheet, height) {
  if (!matchMedia("(max-width: 899px)").matches) {
    return { top: 48, right: 64, bottom: 48, left: 48 };
  }
  const bottom = Math.min(64 + sheet, Math.max(24, height - 24 - 100));
  return { top: 24, right: 60, bottom, left: 24 };
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
   * @param {{pois: object[], satelliteKey: string | null, network?: object}} options  `network`
   *   (the park's WalkNetwork) lets a new route play the search along its paths
   */
  static async create(container, options) {
    const routeMap = new RouteMap(container, await loadStyle(), options);
    await new Promise((resolve) => routeMap.map.once("load", resolve));
    routeMap.setup();
    if (options.network) routeMap.reveal = new Reveal(routeMap.map, options.network);
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
    this.shown = null; // the plan on the map
    this.reveal = null;
    this.sheet = 0; // how much of the map's bottom the plan's sheet covers (phones, px)
    this.fitted = null; // the plan framed last; null once the visitor moves the map
    this.following = false;
    this.locateFit = { maxZoom: 15 }; // the locate button's framing, kept clear of the sheet
    this.stops = []; // the route's stops on the map: their marker, visit and number
    this.seen = []; // stops seen already (ADR 0018), faded with a check: their marker and POI
    this.others = []; // the park's points off the route, drawn as dots
    this.near = null; // what a click would open, under the mouse
    // Closed by `click` below: a click that opens something else moves it instead.
    this.popup = new maplibregl.Popup({
      offset: 14,
      maxWidth: "290px",
      focusAfterOpen: false,
      closeOnClick: false,
    });
    /** Set by the page: what to show in a popup, what a stop is called, what a pick does. */
    this.describe = () => document.createElement("div");
    this.nameOf = (poi) => poi.name;
    this.onPick = () => {};
    /** Set by the page: each position from the locate button, while it's on. */
    this.onLocate = () => {};

    // Short credits on the map (the sheet's footer has the full ones), so they don't hide it.
    this.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: style === PLAIN ? OSM_CREDIT : undefined,
      }),
    );
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    const locate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      fitBoundsOptions: this.locateFit,
    });
    locate.on("geolocate", (position) => this.onLocate(position));
    this.map.addControl(locate);
    if (satelliteKey) {
      this.satellite = new SatelliteToggle(satelliteKey);
      this.map.addControl(this.satellite);
    }
  }

  setup() {
    const map = this.map;
    // Once the visitor moves the map (or the locate button does), stop keeping the route framed.
    map.on("movestart", (event) => {
      if (event.originalEvent || event.geolocateSource) this.following = false;
    });
    map.addSource("legs", { type: "geojson", data: EMPTY });
    map.addSource("pois", { type: "geojson", data: EMPTY, promoteId: "id" });
    // Above the basemap's paths and areas but below its labels, so place names stay readable.
    // (Some styles put a label before the roads: start looking after the last line or area.)
    const layers = map.getStyle().layers;
    const shapes = layers.findLastIndex((layer) => layer.type === "line" || layer.type === "fill");
    const labels = layers.slice(shapes + 1).find((layer) => layer.type === "symbol")?.id;
    const layout = { "line-join": "round", "line-cap": "round" };
    // No fade when the animation hides the route and gives it back: the canvas covers the change.
    const instant = { duration: 0, delay: 0 };
    map.addLayer(
      {
        id: "legs-casing",
        type: "line",
        source: "legs",
        layout,
        paint: {
          "line-color": "#ffffff",
          "line-width": 7,
          "line-opacity": 0.85,
          "line-opacity-transition": instant,
        },
      },
      labels,
    );
    map.addLayer(
      {
        id: "legs",
        type: "line",
        source: "legs",
        layout,
        paint: {
          "line-color": ROUTE_COLOR,
          "line-width": 4,
          "line-opacity": 1,
          "line-opacity-transition": instant,
        },
      },
      labels,
    );
    map.addLayer({
      id: "pois",
      type: "circle",
      source: "pois",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          DOT.zoom[0],
          ["case", NEAR, DOT.radius[0] * 2, DOT.radius[0]],
          DOT.zoom[1],
          ["case", NEAR, DOT.radius[1] * 1.5, DOT.radius[1]],
        ],
        "circle-color": ["get", "color"],
        "circle-opacity": ["case", NEAR, 1, 0.75],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": DOT.rim,
      },
    });
    // A click or a tap opens the stop or point nearest to it, or else closes the popup. The
    // markers take their own clicks, so this is for the dots and for clicks just off a marker.
    const coarse = matchMedia("(pointer: coarse)");
    map.on("click", (event) => {
      if (event.originalEvent.target.closest?.(".maplibregl-popup")) return;
      const target = this.targetAt(event.point, reachFor(event.originalEvent, coarse.matches));
      if (target) this.choose(target);
      else this.close();
    });
    // With a mouse, what a click would open shows under it.
    if (matchMedia("(hover: hover)").matches) {
      map.on("mousemove", (event) => this.hover(this.targetAt(event.point, REACH.mouse)));
      map.on("mouseout", () => this.hover(null));
    }
  }

  /** What a click at `point` (px on the map) opens: a stop, a point, or nothing (pick.js). */
  targetAt(point, reach) {
    const targets = [];
    for (const stop of this.stops) {
      if (stop.element.classList.contains("marker--wait")) continue; // not drawn yet
      const at = this.map.project(stop.visit.lnglat);
      targets.push({ x: at.x, y: at.y, r: stop.element.offsetWidth / 2, stop });
    }
    for (const seen of this.seen) {
      const at = this.map.project([seen.poi.lng, seen.poi.lat]);
      targets.push({ x: at.x, y: at.y, r: seen.element.offsetWidth / 2, seen });
    }
    const r = dotRadius(this.map.getZoom());
    for (const poi of this.others) {
      const at = this.map.project([poi.lng, poi.lat]);
      targets.push({ x: at.x, y: at.y, r, poi });
    }
    return nearest(point, targets, reach);
  }

  /** Open a stop (and point it out in the list), a stop seen already, or a point. */
  choose({ stop, seen, poi }) {
    if (stop) {
      this.open(stop.visit.lnglat, stop.visit.poi?.id ?? null, stop.index);
      this.onPick(stop.index);
    } else {
      const place = seen?.poi ?? poi;
      this.open([place.lng, place.lat], place.id, null);
    }
  }

  /** Show what a click would open: a pointer, and a bigger dot or a ringed marker. */
  hover(target) {
    const thing = target?.stop ?? target?.seen ?? target?.poi ?? null;
    if (thing === this.near) return;
    this.mark(this.near, false);
    this.near = thing;
    this.mark(thing, true);
    this.map.getCanvas().style.cursor = thing ? "pointer" : "";
  }

  /** Point out a stop's marker or a point's dot, or stop pointing it out. */
  mark(thing, on) {
    if (thing?.element) thing.element.classList.toggle("marker--near", on);
    else if (thing) this.map.setFeatureState({ source: "pois", id: thing.id }, { near: on });
  }

  /**
   * Draw a plan: its walks, a numbered marker per stop, the stops `seen` already faded with a
   * check (ADR 0018), and the other points as dots. With `animate`, the search plays first and the
   * route is drawn from the start (ADR 0014). `onFrame` follows along with each step of that
   * animation (see reveal.js `frame`), or gets the end state at once when there's nothing to play.
   */
  show(plan, others, { animate = false, onFrame = () => {}, seen = [] } = {}) {
    this.reveal?.stop();
    this.popup.remove();
    this.hover(null);
    this.markers.forEach((marker) => marker.remove());
    this.markers = [];
    this.stops = [];
    this.others = others;
    // First, so the route's markers are drawn over them.
    this.seen = seen.map((poi) => {
      const element = document.createElement("div");
      element.className = "marker marker--seen";
      element.innerHTML = CHECK;
      element.style.background = KIND_COLOR[poi.kind] ?? KIND_COLOR.other;
      element.tabIndex = 0;
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", t("seenStop", { name: this.nameOf(poi) }));
      const entry = { element, poi };
      const pick = (event) => {
        event.stopPropagation();
        this.choose({ seen: entry });
      };
      element.addEventListener("click", pick);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") pick(event);
      });
      this.markers.push(
        new maplibregl.Marker({ element }).setLngLat([poi.lng, poi.lat]).addTo(this.map),
      );
      return entry;
    });
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
        properties: { id: poi.id, color: KIND_COLOR[poi.kind] ?? KIND_COLOR.other },
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
        element.style.background = KIND_COLOR[visit.poi.kind] ?? KIND_COLOR.other;
        element.setAttribute("aria-label", `${index}. ${this.nameOf(visit.poi)}`);
      }
      const stop = { element, visit, index };
      const pick = (event) => {
        event.stopPropagation();
        this.choose({ stop });
      };
      element.addEventListener("click", pick);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") pick(event);
      });
      this.markers.push(new maplibregl.Marker({ element }).setLngLat(visit.lnglat).addTo(this.map));
      this.stops.push(stop);
    });
    const previous = this.shown;
    this.shown = plan;
    if (animate && this.reveal && plan.legs.length > 0 && !reducedMotion()) {
      this.reveal.play(plan, previous, this.stops, onFrame);
    } else {
      onFrame(FINISHED);
    }
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
    this.fitted = plan;
    this.following = true;
    const bounds = new maplibregl.LngLatBounds();
    for (const leg of plan?.legs ?? []) for (const point of leg) bounds.extend(point);
    this.map.fitBounds(bounds.isEmpty() ? this.parkBounds : bounds, {
      padding: fitPadding(this.sheet, this.map.getContainer().clientHeight),
      maxZoom: 17,
      duration: 500,
    });
  }

  /** Center a place in the part of the map that the sheet leaves in view. */
  focus(lnglat) {
    this.following = false;
    this.map.easeTo({
      center: lnglat,
      zoom: Math.max(this.map.getZoom(), 16),
      offset: [0, -this.sheet / 2],
      duration: 500,
    });
  }

  /**
   * The plan's sheet now covers `sheet` px of the map's bottom (phones). Keep the route framed
   * above it, or, once the visitor has moved the map, keep the middle of their view in view.
   */
  inset(sheet, move = true) {
    const change = sheet - this.sheet;
    this.sheet = sheet;
    this.locateFit.padding = fitPadding(sheet, this.map.getContainer().clientHeight);
    if (!move || Math.abs(change) < 1) return;
    if (this.following) this.fit(this.fitted);
    else this.map.panBy([0, change / 2], { duration: 280 });
  }

  /** No route: only the stops `seen` already, if any. */
  clear(seen = []) {
    this.show({ legs: [], visits: [] }, [], { seen });
  }

  /** Labels made by this module follow the page's language. */
  translate() {
    this.satellite?.translate();
  }
}

// The "finding the route" animation (ADR 0014; the geometry and timing are in reveal.js). It draws
// on a canvas above the map's own drawing and below the markers, with the map's route hidden, and
// gives the route back to the map's layers at the end.
class Reveal {
  constructor(map, network) {
    this.map = map;
    this.network = network;
    this.paths = networkPaths(network);
    this.waves = new Map(); // start node -> its wave, as the same starts come back
    this.canvas = document.createElement("canvas");
    this.canvas.className = "reveal";
    this.canvas.setAttribute("aria-hidden", "true");
    map.getCanvas().after(this.canvas);
    this.context = this.canvas.getContext("2d");
    this.job = null;
    [this.width, this.height, this.ratio] = [0, 0, 1];
  }

  /** Play the search, then draw `plan`'s route. `previous` fades out; `stops` wait their turn. */
  play(plan, previous, stops, onFrame) {
    const job = {
      wave: this.waveFrom(plan.visits[0]),
      line: routeLine(plan.legs),
      old: previous?.legs.length ? routeLine(previous.legs).points : null,
      waiting: stops.filter(({ index }) => index > 0), // the start is there from the beginning
      onFrame,
      began: performance.now(),
      frameId: 0,
    };
    for (const { element } of job.waiting) element.classList.add("marker--wait");
    this.job = job;
    this.setRouteOpacity(0);
    onFrame(frame(0));
    job.frameId = requestAnimationFrame(() => this.tick(job));
  }

  tick(job) {
    if (this.job !== job) return;
    const elapsed = performance.now() - job.began;
    const state = frame(elapsed);
    if (state.done) {
      this.stop();
      return;
    }
    this.draw(job, state, elapsed);
    job.onFrame(state);
    job.frameId = requestAnimationFrame(() => this.tick(job));
  }

  /** Jump to the end: the route back on the map's layers, and every stop shown. */
  stop() {
    const job = this.job;
    if (!job) return;
    this.job = null;
    cancelAnimationFrame(job.frameId);
    for (const { element } of job.waiting) element.classList.remove("marker--wait");
    this.setRouteOpacity(1);
    // Keep the canvas until the map has drawn its own route again, so the line never blinks out.
    this.map.once("render", () => this.job === null && this.clear());
    this.map.triggerRepaint();
    job.onFrame(FINISHED);
  }

  draw(job, state, elapsed) {
    const ctx = this.context;
    this.fit();
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (job.old && state.old > 0) this.strokeRoute(job.old, state.old);

    // The search: every path it reached, faintly, its front blinking, and a flash at the end.
    const glow = state.glow * (1 + state.flash);
    if (glow > 0.01) {
      const front = state.front * job.wave.depth;
      ctx.beginPath();
      this.paths.forEach((path, i) => {
        for (const piece of reached(path, job.wave.reach[i], front)) this.addLine(piece);
      });
      ctx.strokeStyle = ROUTE_COLOR;
      ctx.globalAlpha = Math.min(0.4 * glow, 1);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (state.front < 1) {
        const behind = HEAD * job.wave.depth;
        ctx.strokeStyle = FRONT_COLOR;
        ctx.lineWidth = 4;
        this.paths.forEach((path, i) => {
          const pieces = reached(path, job.wave.reach[i], front, behind);
          if (pieces.length === 0) return;
          ctx.beginPath();
          for (const piece of pieces) this.addLine(piece);
          ctx.globalAlpha = flicker(i, elapsed) * state.glow;
          ctx.stroke();
        });
      }
      ctx.globalAlpha = 1;
    }

    // The route, from the start, with a dot at its tip and each stop shown as the line gets there.
    if (state.drawn > 0) {
      const at = state.drawn * job.line.length;
      const drawn = slice(job.line.points, job.line.along, 0, at);
      this.strokeRoute(drawn, 1);
      const tip = drawn.at(-1);
      if (tip) {
        const { x, y } = this.map.project(tip);
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
        ctx.fillStyle = ROUTE_COLOR;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
      job.waiting = job.waiting.filter(({ element, index }) => {
        if (job.line.visits[index] > at + 0.5) return true;
        element.classList.remove("marker--wait");
        element.classList.add("marker--ping");
        return false;
      });
    }
  }

  /** A route the way the map's layers draw it: orange over a white casing. */
  strokeRoute(points, opacity) {
    const ctx = this.context;
    ctx.beginPath();
    this.addLine(points);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 7;
    ctx.globalAlpha = 0.85 * opacity;
    ctx.stroke();
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = 4;
    ctx.globalAlpha = opacity;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Add a `[lng, lat]` polyline to the canvas's current path, in screen pixels. */
  addLine(points) {
    points.forEach((point, i) => {
      const { x, y } = this.map.project(point);
      if (i === 0) this.context.moveTo(x, y);
      else this.context.lineTo(x, y);
    });
  }

  /** The shortest-path wave from a plan's start: a POI's is kept, a free position's isn't. */
  waveFrom(start) {
    if (!start.poi) {
      const sources = this.network.snap(start.lnglat).seeds;
      return wave(this.paths, this.network.shortestPaths(sources).dist);
    }
    const node = start.poi.node;
    if (!this.waves.has(node)) {
      this.waves.set(node, wave(this.paths, this.network.shortestPaths([[node, 0]]).dist));
    }
    return this.waves.get(node);
  }

  setRouteOpacity(opacity) {
    this.map.setPaintProperty("legs-casing", "line-opacity", 0.85 * opacity);
    this.map.setPaintProperty("legs", "line-opacity", opacity);
  }

  /** Cover the map at the screen's pixel density (it can change size, e.g. with the sheet). */
  fit() {
    const box = this.map.getContainer();
    const [width, height, ratio] = [box.clientWidth, box.clientHeight, devicePixelRatio || 1];
    if (width === this.width && height === this.height && ratio === this.ratio) return;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    [this.width, this.height, this.ratio] = [width, height, ratio];
  }

  clear() {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
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

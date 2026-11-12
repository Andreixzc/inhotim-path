// The planner page: the settings, the itinerary and the map, wired together. Routes are planned
// in a worker (worker.js) so the page stays responsive; where workers can't start, on the main
// thread. No times anywhere (ADR 0010): the route is the shortest walk through what's chosen.
// What's chosen: the museum's categories, and in a separate picker, each stop (ADR 0012) or
// artist (ADR 0013). Stops can be marked as seen (ADR 0018): they leave the route, which goes on
// from the last one seen or from where the visitor is. While their position is known, a stop they
// stay near is suggested.

import { distance } from "./format.js";
import { detect, lang, setLang, t } from "./i18n.js";
import { CHECK, FLAG, KIND_COLOR, RouteMap } from "./map.js";
import { MAX_SNAP_M, Park, normalize } from "./plan.js";
import { routeKey } from "./reveal.js";
import * as seen from "./seen.js";
import { Sheet } from "./sheet.js";
import * as settings from "./state.js";

const DATA_URL = "data/park.json";
const LANG_KEY = "inhotim-path-lang";
const BUSY_AFTER_MS = 150;
const ARTIST_COLOR = "#1d5c45"; // the green of the start and finish markers

const ALERT_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M12 7.5V13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<circle cx="12" cy="16.5" r="1.25" fill="currentColor"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round"/></svg>';
/** The button that marks a stop as seen: a ring, filled with a tick once it's seen (style.css). */
const TICK_ICON =
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
  '<circle class="ring" cx="12" cy="12" r="10"/><path class="tick" d="M7.5 12.5l3 3 6-6.5"/></svg>';
/** The visitor's position counts for re-planning when it's at least this precise (m). */
const PRECISE_M = 100;

const $ = (selector) => document.querySelector(selector);

/** A DOM element: `h("a", {href, class, onclick}, "text", child)`. Text is never parsed as HTML. */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
    else if (name === "class") element.className = value;
    else element.setAttribute(name, value === true ? "" : value);
  }
  element.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return element;
}

/** An icon from the constant SVG markup in this file (never from data). */
function icon(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content.firstChild;
}

/** A pill button that does `action` when pressed; a `primary` one stands out. */
function chip(label, action, primary = false) {
  const style = primary ? "chip-button chip-button--primary" : "chip-button";
  return h("button", { type: "button", class: style, onclick: action }, label);
}

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the page works, it just won't remember.
  }
  return null;
}

/** Plans in a worker, falling back to this thread if the worker can't start. */
class Planner {
  constructor(data, park) {
    this.park = park;
    this.pending = new Map();
    this.nextId = 1;
    try {
      this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      this.worker.addEventListener("message", ({ data: reply }) => this.settle(reply));
      this.worker.addEventListener("error", () => this.fallback());
      this.worker.postMessage({ type: "park", park: data });
    } catch {
      this.worker = null;
    }
  }

  plan(request) {
    if (!this.worker) return new Promise((resolve) => resolve(this.park.plan(request)));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, request });
      this.worker.postMessage({ type: "plan", id, request });
    });
  }

  settle({ id, plan, error }) {
    const job = this.pending.get(id);
    if (!job) return;
    this.pending.delete(id);
    if (error) job.reject(Object.assign(new Error(error.message), { code: error.code }));
    else job.resolve(plan);
  }

  fallback() {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.pending.values()) {
      try {
        job.resolve(this.park.plan(job.request));
      } catch (error) {
        job.reject(error);
      }
    }
    this.pending.clear();
  }
}

const app = {
  data: null,
  park: null,
  planner: null,
  map: null,
  state: null,
  here: null, // [lng, lat] when the visit starts from the visitor's position
  locating: false,
  plan: null,
  shownKey: null, // the route the map last played the search for (ADR 0014)
  shownM: null, // the distance in the summary, which a new route counts from
  error: null, // why there is no plan
  alert: null, // a location problem until dismissed: {kind: "outside", meters} or {kind: "geo"}
  latest: 0,
  timer: 0,
  open: {}, // which of the picker's groups are expanded
  picked: false, // the picker changed something since it opened
  seen: seen.empty(), // stops marked as seen, kept on the phone (seen.js)
  linger: new seen.Linger(), // suggests marking a stop the visitor stays near
  fix: null, // the visitor's latest position, while it's known: {lnglat, accuracy, time}
  watch: null, // the position watch while starting from "my location"
  suggestion: null, // the id of the stop suggested as seen, on screen
};

// ----------------------------------------------------------------------------- start up

async function main() {
  setLang(detect(storage(LANG_KEY), navigator.languages ?? [navigator.language]));
  translatePage();
  $("#meta").textContent = t("loading");
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(String(response.status));
    app.data = await response.json();
  } catch {
    $("#meta").textContent = t("loadError");
    return;
  }
  app.park = new Park(app.data);
  app.planner = new Planner(app.data, app.park);
  app.seen = seen.load((id) => (app.park.byId.get(id)?.node ?? null) !== null);
  app.state = settings.load(location.hash);
  buildForm();
  renderFooter();
  wireEvents();
  RouteMap.create($("#map"), {
    pois: app.data.pois,
    satelliteKey: app.data.config?.maptiler_key ?? null,
    network: app.park.network,
  }).then((map) => {
    app.map = map;
    map.inset(app.sheet.visible, false);
    map.describe = describe;
    map.nameOf = nameOf;
    map.onPick = highlight;
    map.onLocate = onFix;
    showOnMap(true);
  });
  await replan({ fit: true });
}

function wireEvents() {
  const form = $("#form");
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("change", onFormChange);
  const picker = $("#picker");
  $("#customize").addEventListener("click", openPicker);
  $("#picker-done").addEventListener("click", () => picker.close());
  $("#start-over").addEventListener("click", startOver);
  picker.addEventListener("close", onPickerClose);
  picker.addEventListener("click", (event) => {
    // A click on the backdrop (beside the panel, on wide screens) closes it.
    const box = picker.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    const outside = x < box.left || x > box.right || y < box.top || y > box.bottom;
    if (event.target === picker && outside) picker.close();
  });
  $("#picker-groups").addEventListener("change", onPickerChange);
  $("#picker-search").addEventListener("input", filterPicker);
  $("#picker-search").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.value) {
      event.preventDefault(); // clear the search first; the next Escape closes the picker
      event.target.value = "";
      filterPicker();
    }
  });
  $("#lang").addEventListener("click", () => {
    setLang(lang() === "en" ? "pt-BR" : "en");
    storage(LANG_KEY, lang());
    translatePage();
    buildForm();
    renderFooter();
    renderAlert();
    app.map?.translate();
    render();
    showOnMap(false);
  });
  $("#sheet-body").addEventListener(
    "scroll",
    (event) => document.body.classList.toggle("scrolled", event.target.scrollTop > 4),
    { passive: true },
  );
  // Phones: the plan's sheet, over the map, follows a finger (ADR 0016).
  app.sheet = new Sheet({
    sheet: $(".sheet"),
    handle: $("#sheet"),
    grips: [$("#sheet"), $(".top"), $(".hero")],
    body: $("#sheet-body"),
    onSettle: (sheet) => {
      document.body.classList.toggle("collapsed", sheet.collapsed);
      labelSheetToggle();
      app.map?.inset(sheet.visible);
    },
  });
  addEventListener("hashchange", () => {
    if (location.hash === `#${settings.toHash(app.state)}`) return;
    app.state = settings.load(location.hash);
    buildForm();
    changed({ fit: true });
  });
}

// ----------------------------------------------------------------------------- planning

function request() {
  const s = app.state;
  const start = startAt();
  return {
    kinds: s.kinds,
    must: s.must,
    exclude: [...s.exclude, ...seen.ids(app.seen)],
    start: start.position ?? start.poi,
    // From a stop seen, back to the Portaria (by default, a route from a stop goes back to it).
    end: start.poi === undefined ? undefined : app.data.defaults.start,
  };
}

/**
 * Where the route starts: the visitor's position, the stop they saw last today (ADR 0018), or the
 * Portaria (`{}`, the planner's default).
 */
function startAt() {
  if (app.state.from === "here") return app.here ? { position: app.here } : {};
  const id = seen.continueFrom(app.seen, Date.now());
  return id === null ? {} : { poi: id };
}

/** Whether something chosen has been seen: then "nothing left" means "all seen". */
function seenSome() {
  const gate = app.data.defaults.start;
  return app.data.pois.some(
    (poi) => poi.id !== gate && seen.has(app.seen, poi.id) && settings.isChosen(app.state, poi),
  );
}

/** The stops seen that the map can show, oldest first. */
function seenPois() {
  return seen
    .ids(app.seen)
    .map((id) => app.park.byId.get(id))
    .filter((poi) => poi && poi.node !== null);
}

/** The settings changed: remember them, and plan again shortly (a burst of taps plans once). */
function changed({ fit = false, now = false } = {}) {
  settings.save(app.state);
  history.replaceState(null, "", `#${settings.toHash(app.state)}`);
  clearTimeout(app.timer);
  app.timer = setTimeout(() => replan({ fit }), now ? 0 : 120);
}

async function replan({ fit = false } = {}) {
  const id = ++app.latest;
  const busy = setTimeout(() => document.body.classList.add("busy"), BUSY_AFTER_MS);
  try {
    app.plan = await app.planner.plan(request());
    app.error = null;
  } catch (error) {
    if (id !== app.latest) return;
    if (error.code === "far" && app.here) {
      locationFailed({ kind: "outside", meters: app.park.network.snap(app.here).distance });
      return;
    }
    app.plan = null;
    if (error.code === "no-stops") app.error = seenSome() ? t("allSeen") : t("noStops");
    else app.error = t("planFailed");
    if (!error.code) console.error(error);
  } finally {
    clearTimeout(busy);
    if (id === app.latest) document.body.classList.remove("busy");
  }
  if (id !== app.latest) return;
  const shown = app.shownM; // the summary counts from here to the new route
  render();
  showOnMap(fit, shown);
}

/**
 * A new route plays the search on the map first (ADR 0014), and the summary follows: it waits, then
 * counts from `from` meters to the new length. Not behind the picker: when it closes instead.
 */
function showOnMap(fit, from = null) {
  if (!app.map) return;
  const done = seenPois();
  if (app.plan) {
    const visited = new Set(app.plan.visits.map((visit) => visit.poi?.id));
    const marked = new Set(seen.ids(app.seen));
    const others = app.data.pois.filter(
      (poi) => poi.node !== null && !visited.has(poi.id) && !marked.has(poi.id),
    );
    const key = routeKey(app.plan);
    const animate = key !== app.shownKey && !$("#picker").open;
    if (animate) app.shownKey = key;
    const start = from ?? app.plan.walkM;
    app.map.show(app.plan, others, {
      animate,
      onFrame: (state) => renderHero({ ...state, from: start }),
      seen: done.filter((poi) => !visited.has(poi.id)), // the last one seen may be the start
    });
  } else {
    app.shownKey = null;
    app.map.clear(done);
  }
  if (fit) app.map.fit(app.plan);
}

function locate() {
  if (!navigator.geolocation) {
    locationFailed({ kind: "geo" });
    return;
  }
  stopWatching();
  app.locating = true;
  renderHero();
  // Watched while starting from here: the first position plans, later ones can suggest stops.
  let first = true;
  app.watch = navigator.geolocation.watchPosition(
    (position) => {
      onFix(position);
      if (!first) return;
      first = false;
      app.locating = false;
      if (app.state.from !== "here") return; // changed their mind while we waited
      const here = [position.coords.longitude, position.coords.latitude];
      const away = app.park.network.snap(here).distance;
      if (away > MAX_SNAP_M) {
        locationFailed({ kind: "outside", meters: away });
        return;
      }
      app.here = here;
      changed({ fit: true, now: true });
    },
    () => {
      if (!first) return; // a later position failed: the last one stands
      first = false;
      stopWatching();
      app.locating = false;
      if (app.state.from === "here") locationFailed({ kind: "geo" });
      else renderHero();
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

function stopWatching() {
  if (app.watch !== null) navigator.geolocation.clearWatch(app.watch);
  app.watch = null;
}

/** Starting from the visitor's position didn't work: say why, and start at the gate. */
function locationFailed(alert) {
  stopWatching();
  app.here = null;
  app.alert = alert;
  app.state.from = "gate";
  syncFrom();
  renderAlert();
  changed({ fit: true, now: true });
}

// ----------------------------------------------------------------------------- actions

/** Put a POI on the route, or take it off (from its popup on the map). */
function setStop(id, on) {
  app.map?.close();
  settings.setStop(app.state, app.park.byId.get(id), on);
  syncKinds();
  changed({ fit: on, now: true });
}

/** Mark a stop as seen, or not: the route goes on with what's left (ADR 0018). */
function setSeen(id, on) {
  app.map?.close();
  app.seen = on ? seen.mark(app.seen, id, Date.now()) : seen.unmark(app.seen, id);
  seen.save(app.seen);
  // Starting from where the visitor is: from where they are now.
  const fix = app.fix;
  const precise = fix !== null && fix.accuracy <= PRECISE_M;
  if (on && app.state.from === "here" && app.here && precise) app.here = fix.lnglat;
  if (app.suggestion === id) app.suggestion = null;
  renderSuggestion();
  changed({ fit: app.map?.following ?? false, now: true });
}

/** Forget every stop marked as seen, once the visitor confirms. */
function startOver() {
  if (!confirm(t("startOverConfirm"))) return;
  app.seen = seen.empty();
  seen.save(app.seen);
  app.linger = new seen.Linger();
  app.suggestion = null;
  renderSuggestion();
  changed({ fit: true, now: true });
}

/** A new position, from "my location" or the locate button: maybe a stop to suggest as seen. */
function onFix(position) {
  const { longitude, latitude, accuracy } = position.coords;
  app.fix = { lnglat: [longitude, latitude], accuracy, time: position.timestamp || Date.now() };
  if (!app.plan) return;
  const stops = app.plan.visits
    .slice(1, -1)
    .map((visit) => ({ id: visit.poi.id, lnglat: visit.lnglat }));
  const id = app.linger.update(app.fix, stops);
  if (id === null) return;
  app.suggestion = id;
  renderSuggestion();
}

function pick(index) {
  const visit = app.plan.visits[index];
  app.map?.open(visit.lnglat, visit.poi?.id ?? null, index);
  app.map?.focus(visit.lnglat);
  highlight(index);
}

function highlight(index) {
  for (const item of document.querySelectorAll(".stop.is-picked")) {
    item.classList.remove("is-picked");
  }
  const item = document.querySelector(`.stop[data-index="${index}"]`);
  if (!item) return;
  item.classList.add("is-picked");
  item.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function onFormChange(event) {
  const s = app.state;
  const target = event.target;
  if (target.name === "from") {
    s.from = target.value;
    app.alert = null;
    renderAlert();
    if (s.from === "here") {
      locate();
    } else {
      stopWatching();
      app.here = null;
      // The Portaria, chosen: the stops seen so far no longer move the start (ADR 0018).
      app.seen = seen.restart(app.seen, Date.now());
      seen.save(app.seen);
      changed({ fit: true });
    }
    syncFrom();
  } else if (target.name === "kind") {
    settings.setKind(s, target.value, target.checked, app.data.pois);
    renderCustomNote();
    changed({ fit: true });
  }
}

// ----------------------------------------------------------------------------- settings

function translatePage() {
  document.documentElement.lang = lang();
  document.title = t("title");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll("[data-i18n-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nLabel));
  }
  const other = $("#lang");
  other.textContent = t("language");
  other.setAttribute("aria-label", t("languageName"));
  other.lang = lang() === "en" ? "pt-BR" : "en";
  labelSheetToggle();
}

function labelSheetToggle() {
  const collapsed = document.body.classList.contains("collapsed");
  $("#sheet-label").textContent = collapsed ? t("showPlan") : t("showMap");
  $("#sheet").setAttribute("aria-expanded", String(!collapsed));
}

/** The gate is "Portaria" (the museum's map calls it the reception); other POIs by name. */
function nameOf(poi) {
  return poi.id === app.data.defaults.start ? t("gate") : poi.name;
}

/**
 * Where the route starts, in the form: nothing ticked while the visit goes on from the stop seen
 * last, with a note that says so (ADR 0018).
 */
function syncFrom() {
  const start = startAt();
  const from = start.poi === undefined ? app.state.from : null;
  for (const input of document.querySelectorAll("#from input")) {
    input.checked = input.value === from;
  }
  const poi = start.poi === undefined ? null : app.park.byId.get(start.poi);
  const note = $("#from-note");
  note.textContent = poi ? t("continuingFrom", { name: nameOf(poi) }) : "";
  note.hidden = !poi;
}

function buildForm() {
  syncFrom();
  // A chip per category, in the map's color for it.
  const chips = settings.KINDS.map((kind) =>
    h(
      "label",
      { class: "kind", style: `--kind: ${KIND_COLOR[kind]}` },
      h("input", { type: "checkbox", name: "kind", value: kind }),
      h("span", {}, t(`kinds.${kind}`)),
    ),
  );
  $("#kinds").replaceChildren(...chips);
  syncKinds();
}

function syncKinds() {
  for (const box of document.querySelectorAll("#kinds input")) {
    box.checked = app.state.kinds.includes(box.value);
  }
  renderCustomNote();
}

/** Beside "Customize": the stops added to the categories, and those skipped. */
function renderCustomNote() {
  const s = app.state;
  const count = (ids, covered) =>
    ids.filter((id) => {
      const poi = app.park.byId.get(id);
      return poi && settings.covers(s, poi) === covered;
    }).length;
  const added = count(s.must, false);
  const skipped = count(s.exclude, true);
  const parts = [];
  if (added) parts.push(t("addedN", { n: added }));
  if (skipped) parts.push(t("skippedN", { n: skipped }));
  $("#custom-note").textContent = parts.join(" · ");
}

// ----------------------------------------------------------------------------- the picker

/** The stops each of the picker's boxes stands for (one POI, or an artist's), by `data-row`. */
let pickerRows = [];

/**
 * What the picker lists: each category's POIs, then the artists, then the rest (found only by
 * searching). A row is a POI, or an artist with their stops.
 */
function pickerGroups() {
  const start = app.data.defaults.start;
  const routable = app.data.pois.filter((poi) => poi.node !== null && poi.id !== start);
  const listed = (poi) => poi.main_view && settings.KINDS.includes(poi.kind);
  const byLabel = (a, b) => a.label.localeCompare(b.label, lang());
  const poiRow = (poi, withKind) => {
    // Artists, unless the name says it already ("Doug Aitken", "Galeria Adriana Varejão").
    const name = normalize(poi.name);
    const artists = poi.artists.filter((artist) => !name.includes(normalize(artist)));
    const about = withKind ? [t(`kind.${poi.kind}`), ...artists] : artists;
    if (seen.has(app.seen, poi.id)) about.push(t("seenTag"));
    return { label: poi.name, about, text: [poi.name, ...poi.artists], stops: [poi] };
  };
  const artistRow = ([artist, stops]) => ({
    label: artist,
    // Their stops; the kind for one named after them ("Doris Salcedo": a gallery).
    about: stops.map((poi) =>
      normalize(poi.name) === normalize(artist) ? t(`kind.${poi.kind}`) : poi.name,
    ),
    text: [artist, ...stops.map((poi) => poi.name)],
    stops,
  });
  const rows = (pois, withKind = false) => pois.map((poi) => poiRow(poi, withKind)).sort(byLabel);
  return [
    ...settings.KINDS.map((kind) => ({
      kind,
      rows: rows(routable.filter((poi) => listed(poi) && poi.kind === kind)),
    })),
    { kind: "artist", rows: [...settings.artistStops(routable)].map(artistRow).sort(byLabel) },
    { kind: "other", rows: rows(routable.filter((poi) => !listed(poi)), true) },
  ];
}

function buildPicker() {
  pickerRows = [];
  const sections = pickerGroups().map(({ kind, rows }) => {
    const title = t(`kinds.${kind}`);
    const items = rows.map((row) => {
      pickerRows.push(row.stops);
      return h(
        "li",
        { "data-text": normalize(row.text.join(" ")) },
        h(
          "label",
          { class: "check" },
          h("input", { type: "checkbox", "data-row": String(pickerRows.length - 1) }),
          h(
            "span",
            { class: "check__text" },
            row.label,
            row.about.length ? h("small", {}, row.about.join(" · ")) : null,
          ),
        ),
      );
    });
    // A box for the whole category. Artists and "other" have none: a spacer keeps the names in
    // line.
    const all = settings.KINDS.includes(kind)
      ? h("input", {
          type: "checkbox",
          class: "group__all",
          "data-kind": kind,
          "aria-label": title,
        })
      : h("span", { class: "group__all" });
    const color = kind === "artist" ? ARTIST_COLOR : (KIND_COLOR[kind] ?? KIND_COLOR.other);
    const section = h(
      "section",
      { class: "group", "data-kind": kind, style: `--kind: ${color}` },
      h(
        "div",
        { class: "group__head" },
        all,
        h(
          "button",
          {
            type: "button",
            class: "group__more",
            "aria-expanded": "false",
            "aria-controls": `picker-${kind}`,
            onclick: (event) => {
              const open = event.currentTarget.getAttribute("aria-expanded") !== "true";
              expand(section, open);
              app.open[kind] = open;
            },
          },
          h("span", { class: "group__title" }, title),
          h("span", { class: "group__count" }),
        ),
      ),
      h("ul", { id: `picker-${kind}`, class: "group__items", hidden: true }, items),
    );
    return section;
  });
  const empty = h("p", { id: "picker-empty", class: "picker__empty", hidden: true });
  empty.textContent = t("noMatches");
  $("#picker-groups").replaceChildren(...sections, empty);
}

function expand(section, open) {
  section.querySelector(".group__more").setAttribute("aria-expanded", String(open));
  section.querySelector(".group__items").hidden = !open;
}

function openPicker() {
  buildPicker();
  $("#picker-search").value = "";
  $("#picker").showModal();
  app.picked = false;
  syncPicker();
  filterPicker();
}

/** The picker's boxes and counts, from the settings: a box is ticked when all its stops are. */
function syncPicker() {
  if (!$("#picker").open) return;
  const chosen = (poi) => settings.isChosen(app.state, poi);
  for (const section of document.querySelectorAll("#picker-groups .group")) {
    const boxes = [...section.querySelectorAll(".group__items input")];
    let full = 0;
    for (const box of boxes) {
      const stops = pickerRows[Number(box.dataset.row)];
      const on = stops.filter(chosen).length;
      box.checked = on === stops.length;
      box.indeterminate = on > 0 && on < stops.length;
      if (box.checked) full += 1;
    }
    const all = section.querySelector("input.group__all");
    if (all) {
      all.checked = boxes.length > 0 && full === boxes.length;
      all.indeterminate = full > 0 && full < boxes.length;
    }
    section.querySelector(".group__count").textContent =
      section.dataset.kind === "other" ? "" : t("countOf", { n: full, total: boxes.length });
  }
  renderPickerNote();
}

/** Show what matches the search, in every group; without a search, the groups as they were. */
function filterPicker() {
  const needle = normalize($("#picker-search").value);
  let found = 0;
  for (const section of document.querySelectorAll("#picker-groups .group")) {
    let matches = 0;
    for (const item of section.querySelectorAll(".group__items li")) {
      item.hidden = Boolean(needle) && !item.dataset.text.includes(needle);
      if (!item.hidden) matches += 1;
    }
    const kind = section.dataset.kind;
    section.hidden = needle ? matches === 0 : kind === "other";
    expand(section, needle ? matches > 0 : Boolean(app.open[kind]));
    if (needle) found += matches;
  }
  $("#picker-empty").hidden = !needle || found > 0;
}

function onPickerChange(event) {
  const box = event.target;
  if (box.classList.contains("group__all")) {
    settings.setKind(app.state, box.dataset.kind, box.checked, app.data.pois);
  } else {
    for (const poi of pickerRows[Number(box.dataset.row)]) {
      settings.setStop(app.state, poi, box.checked);
    }
  }
  app.picked = true;
  syncKinds();
  syncPicker();
  changed();
}

function onPickerClose() {
  if (app.picked) changed({ fit: true, now: true });
  app.picked = false;
}

/** The picker's summary: the route as it is now. */
function renderPickerNote() {
  const plan = app.plan;
  $("#picker-note").textContent = plan
    ? `${t("stops", { n: plan.visits.length - 2 })} · ${distance(plan.walkM, lang())}`
    : (app.error ?? "");
}

// ----------------------------------------------------------------------------- results

function render() {
  renderHero();
  renderNotices(app.plan);
  renderPickerNote();
  syncFrom();
  renderSeen();
  renderSuggestion();
  if (!app.plan) {
    $("#itinerary").replaceChildren();
    return;
  }
  renderItinerary(app.plan);
}

/**
 * The summary: the route's length and stops. While the map plays the search (`reveal`, a frame of
 * reveal.js with the length to count `from`), it says so, then counts to the new length as the
 * route is drawn.
 */
function renderHero(reveal = null) {
  const playing = reveal !== null && !reveal.done;
  document.body.classList.toggle("searching", playing && reveal.searching);
  $(".hero").setAttribute("aria-busy", String(playing)); // screen readers hear the result once
  if (app.locating) {
    $("#meta").textContent = t("locating");
    return;
  }
  const plan = app.plan;
  if (!plan) {
    setTotal(null);
    $("#meta").textContent = app.error ?? "";
    return;
  }
  setTotal(playing ? reveal.from + (plan.walkM - reveal.from) * reveal.drawn : plan.walkM);
  const count = seen.ids(app.seen).length;
  const stops = t("stops", { n: plan.visits.length - 2 });
  $("#meta").textContent =
    playing && reveal.searching
      ? t("searching")
      : count
        ? `${stops} · ${t("seenN", { n: count })}`
        : stops;
}

/** The big number, remembered so that the next route can count from it. */
function setTotal(meters) {
  app.shownM = meters;
  $("#total").textContent = meters === null ? "—" : distance(meters, lang());
}

function renderAlert() {
  const box = $("#alert");
  const alert = app.alert;
  if (!alert) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const [title, body] =
    alert.kind === "outside"
      ? [t("outsideTitle"), t("outsideBody", { distance: distance(alert.meters, lang()) })]
      : [t("geoFailedTitle"), t("geoFailedBody")];
  const dismiss = () => {
    app.alert = null;
    renderAlert();
  };
  box.replaceChildren(
    icon(ALERT_ICON),
    h("div", { class: "alert__text" }, h("strong", {}, title), h("p", {}, body)),
    h("button", { type: "button", "aria-label": t("dismiss"), onclick: dismiss }, icon(CLOSE_ICON)),
  );
  box.hidden = false;
}

function renderNotices(plan) {
  const notes = [];
  if (plan?.unreachable.length) {
    const names = plan.unreachable.map((poi) => poi.name).join(", ");
    notes.push(t("unreachable", { names }));
  }
  $("#notices").replaceChildren(
    ...notes.map((text) => h("p", { class: "notice notice--info" }, text)),
  );
}

function renderItinerary(plan) {
  const last = plan.visits.length - 1;
  const goingOn = startAt().poi !== undefined; // from the stop seen last
  const items = plan.visits.map((visit, index) => {
    const ends = index === 0 || index === last;
    let name;
    let meta;
    if (ends) {
      name = visit.poi ? nameOf(visit.poi) : t("youAreHere");
      meta = index === 0 ? t(goingOn ? "leftOff" : "start") : t("finish");
    } else {
      name = [h("span", { class: "visually-hidden" }, `${index}. `), visit.poi.name];
      meta = [t(`kind.${visit.poi.kind}`), ...visit.poi.artists].join(" · ");
    }
    // The same colors as the map's markers.
    const color = ends ? null : (KIND_COLOR[visit.poi.kind] ?? KIND_COLOR.other);
    const badge = h(
      "span",
      {
        class: ends ? "badge badge--end" : "badge",
        style: color && `background: ${color}`,
        "aria-hidden": "true",
      },
      ends ? icon(FLAG) : String(index),
    );
    const row = h(
      "button",
      { type: "button", class: "stop__row", onclick: () => pick(index) },
      badge,
      h(
        "span",
        { class: "stop__text" },
        h("span", { class: "stop__name" }, name),
        h("span", { class: "stop__meta" }, meta),
      ),
    );
    const check = ends
      ? null
      : h(
          "button",
          {
            type: "button",
            class: "stop__check",
            "aria-label": t("markSeen", { name: visit.poi.name }),
            onclick: () => setSeen(visit.poi.id, true),
          },
          icon(TICK_ICON),
        );
    const walk = index > 0 ? h("p", { class: "walk" }, walkLabel(visit)) : null;
    return h(
      "li",
      { class: "stop", "data-index": String(index) },
      walk,
      h("div", { class: "stop__line" }, row, check),
    );
  });
  $("#itinerary").replaceChildren(...items);
}

/** The stops seen, the latest first, each with a button that unmarks it (ADR 0018). */
function renderSeen() {
  const pois = seenPois().reverse();
  $("#seen").hidden = pois.length === 0;
  const items = pois.map((poi) => {
    const color = KIND_COLOR[poi.kind] ?? KIND_COLOR.other;
    const lnglat = [poi.lng, poi.lat];
    const show = () => {
      app.map?.open(lnglat, poi.id, null);
      app.map?.focus(lnglat);
    };
    const row = h(
      "button",
      { type: "button", class: "stop__row", onclick: show },
      h(
        "span",
        { class: "badge badge--seen", style: `background: ${color}`, "aria-hidden": "true" },
        icon(CHECK),
      ),
      h(
        "span",
        { class: "stop__text" },
        h("span", { class: "stop__name" }, poi.name),
        h("span", { class: "stop__meta" }, [t(`kind.${poi.kind}`), ...poi.artists].join(" · ")),
      ),
    );
    const unmark = h(
      "button",
      {
        type: "button",
        class: "stop__check stop__check--on",
        "aria-label": t("unmarkSeen", { name: poi.name }),
        onclick: () => setSeen(poi.id, false),
      },
      icon(TICK_ICON),
    );
    return h("li", { class: "stop" }, h("div", { class: "stop__line" }, row, unmark));
  });
  $("#seen-list").replaceChildren(...items);
}

/** "You're at …: seen it?", for a stop on the route the visitor has stayed near (ADR 0018). */
function renderSuggestion() {
  const box = $("#suggestion");
  const id = app.suggestion;
  const onRoute = app.plan?.visits.slice(1, -1).some((visit) => visit.poi.id === id) ?? false;
  if (id === null || !onRoute || seen.has(app.seen, id)) {
    app.suggestion = null;
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const dismiss = () => {
    app.suggestion = null;
    renderSuggestion();
  };
  box.replaceChildren(
    h("p", { class: "suggestion__text" }, t("suggest", { name: nameOf(app.park.byId.get(id)) })),
    chip(t("seenIt"), () => setSeen(id, true), true),
    h("button", { type: "button", "aria-label": t("dismiss"), onclick: dismiss }, icon(CLOSE_ICON)),
  );
  box.hidden = false;
}

/** How far it is from the stop before. */
function walkLabel(visit) {
  return visit.walkM < 20 ? t("nextDoor") : distance(visit.walkM, lang());
}

function officialLink(poi) {
  if (!/^https?:\/\//i.test(poi?.url ?? "")) return null;
  return h(
    "a",
    { href: poi.url, target: "_blank", rel: "noopener", class: "chip-button" },
    `${t("officialPage")} ↗`,
  );
}

/** What the map's popup shows for a POI, or for the start position when `poiId` is null. */
function describe(poiId, index) {
  const box = h("div", { class: "popup" });
  const poi = poiId === null ? null : app.park.byId.get(poiId);
  if (!poi) {
    box.append(h("strong", {}, t("youAreHere")));
    return box;
  }
  const visits = app.plan?.visits ?? [];
  const at = index ?? visits.findIndex((visit) => visit.poi?.id === poi.id);
  const visit = at >= 0 ? visits[at] : null;
  const ends = visit !== null && (at === 0 || at === visits.length - 1);
  const isStop = visit !== null && !ends;
  const isSeen = seen.has(app.seen, poi.id);
  box.append(h("strong", {}, isStop ? `${at}. ${nameOf(poi)}` : nameOf(poi)));
  const about = [t(`kind.${poi.kind}`), ...poi.artists, isSeen ? t("seenTag") : null];
  box.append(h("p", {}, about.filter(Boolean).join(" · ")));
  const actions = h("div", { class: "popup__actions" });
  if (!ends && poi.id !== app.data.defaults.start) {
    if (isStop) {
      actions.append(
        chip(t("seenIt"), () => setSeen(poi.id, true), true),
        chip(t("skip"), () => setStop(poi.id, false)),
      );
    } else if (isSeen) {
      actions.append(chip(t("unmark"), () => setSeen(poi.id, false)));
    } else {
      actions.append(chip(t("add"), () => setStop(poi.id, true)));
    }
  }
  const link = officialLink(poi);
  if (link) actions.append(link);
  if (actions.childElementCount) box.append(actions);
  return box;
}

function renderFooter() {
  const date = new Date(app.data.fetched_at ?? app.data.generated_at);
  const options = { day: "numeric", month: "long", year: "numeric" };
  $("#data-date").textContent = Number.isNaN(date.getTime())
    ? ""
    : t("dataFrom", { date: date.toLocaleDateString(lang(), options) });
  $("#attribution").textContent = app.data.attribution;
}

main();

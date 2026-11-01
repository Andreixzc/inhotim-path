// The planner page: the settings, the itinerary and the map, wired together. Routes are planned
// in a worker (worker.js) so the page stays responsive; where workers can't start, on the main
// thread.

import { clock, distance, duration, nowRounded, parseClock } from "./format.js";
import { detect, lang, setLang, t } from "./i18n.js";
import { FLAG, RouteMap } from "./map.js";
import { MAX_SNAP_M, Park } from "./plan.js";
import * as settings from "./state.js";

const DATA_URL = "data/park.json";
const LANG_KEY = "inhotim-path-lang";
const SEARCH_LIMIT = 8;
const BUSY_AFTER_MS = 150;

const ALERT_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M12 7.5V13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<circle cx="12" cy="16.5" r="1.25" fill="currentColor"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round"/></svg>';

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

/** A pill button that does `action` when pressed; `dark` for the main action. */
function chip(label, action, dark = false) {
  const className = dark ? "chip-button chip-button--dark" : "chip-button";
  return h("button", { type: "button", class: className, onclick: action }, label);
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
  error: null, // why there is no plan
  alert: null, // a location problem until dismissed: {kind: "outside", meters} or {kind: "geo"}
  latest: 0,
  timer: 0,
  open: {}, // which "left out" lists are expanded
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
  app.state = settings.load(location.hash);
  buildForm();
  renderFooter();
  wireEvents();
  RouteMap.create($("#map"), {
    pois: app.data.pois,
    satelliteKey: app.data.config?.maptiler_key ?? null,
  }).then((map) => {
    app.map = map;
    map.describe = describe;
    map.nameOf = nameOf;
    map.onPick = highlight;
    showOnMap(true);
  });
  await replan({ fit: true });
}

function wireEvents() {
  const form = $("#form");
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("change", onFormChange);
  $("#start-time").addEventListener("change", onStartTime);
  $("#less").addEventListener("click", () => stepBudget(-1));
  $("#more").addEventListener("click", () => stepBudget(1));
  $("#must-search").addEventListener("input", renderResults);
  $("#must-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("#must-results button")?.click();
    } else if (event.key === "Escape") {
      event.target.value = "";
      renderResults();
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
  $("#sheet").addEventListener("click", () => {
    document.body.classList.toggle("collapsed");
    labelSheetToggle();
    requestAnimationFrame(() => app.map?.resize());
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
  return {
    kinds: settings.SEE[s.see],
    must: s.must,
    exclude: s.exclude,
    budgetMin: s.budgetMin,
    start: s.from === "here" && app.here ? app.here : undefined,
  };
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
    app.error = error.code === "no-stops" ? t("noStops") : t("planFailed");
    if (!error.code) console.error(error);
  } finally {
    clearTimeout(busy);
    if (id === app.latest) document.body.classList.remove("busy");
  }
  if (id !== app.latest) return;
  render();
  showOnMap(fit);
}

function showOnMap(fit) {
  if (!app.map) return;
  if (app.plan) {
    const visited = new Set(app.plan.visits.map((visit) => visit.poi?.id));
    const others = app.data.pois.filter((poi) => poi.node !== null && !visited.has(poi.id));
    app.map.show(app.plan, others);
  } else {
    app.map.clear();
  }
  if (fit) app.map.fit(app.plan);
}

function locate() {
  if (!navigator.geolocation) {
    locationFailed({ kind: "geo" });
    return;
  }
  app.locating = true;
  renderHero();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      app.locating = false;
      if (app.state.from !== "here") return; // changed their mind while we waited
      const here = [position.coords.longitude, position.coords.latitude];
      const away = app.park.network.snap(here).distance;
      if (away > MAX_SNAP_M) {
        locationFailed({ kind: "outside", meters: away }); // their start time stays as it was
        return;
      }
      app.here = here;
      app.state.startTime = nowRounded();
      $("#start-time").value = app.state.startTime;
      changed({ fit: true, now: true });
    },
    () => {
      app.locating = false;
      if (app.state.from === "here") locationFailed({ kind: "geo" });
      else renderHero();
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

/** Starting from the visitor's position didn't work: say why, and start at the gate. */
function locationFailed(alert) {
  app.here = null;
  app.alert = alert;
  app.state.from = "gate";
  $('#from input[value="gate"]').checked = true;
  renderAlert();
  changed({ fit: true, now: true });
}

// ----------------------------------------------------------------------------- actions

function skip(id) {
  app.map?.close();
  app.state.must = app.state.must.filter((other) => other !== id);
  if (!app.state.exclude.includes(id)) app.state.exclude.push(id);
  renderChips();
  changed({ now: true });
}

function restore(id) {
  app.state.exclude = app.state.exclude.filter((other) => other !== id);
  changed({ fit: true, now: true });
}

function makeMust(id) {
  app.map?.close();
  app.state.exclude = app.state.exclude.filter((other) => other !== id);
  if (!app.state.must.includes(id)) app.state.must.push(id);
  renderChips();
  changed({ fit: true, now: true });
}

function unmakeMust(id) {
  app.map?.close();
  app.state.must = app.state.must.filter((other) => other !== id);
  renderChips();
  changed({ fit: true, now: true });
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

function stepBudget(step) {
  const budgets = settings.BUDGETS;
  const index = budgets.indexOf(app.state.budgetMin);
  const next = budgets[Math.min(budgets.length - 1, Math.max(0, index + step))];
  if (next === app.state.budgetMin) return;
  app.state.budgetMin = next;
  renderStepper();
  changed({ fit: true });
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
      app.here = null;
      changed({ fit: true });
    }
  } else if (target.name === "see") {
    s.see = target.value;
    changed({ fit: true });
  }
}

function onStartTime(event) {
  if (parseClock(event.target.value) === null) return;
  app.state.startTime = event.target.value;
  settings.save(app.state);
  history.replaceState(null, "", `#${settings.toHash(app.state)}`);
  render(); // times of day only: no need to plan again
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

function budgetLabel(minutes) {
  if (minutes === null) return t("noLimit");
  return minutes % 60 ? duration(minutes * 60) : t("hours", { h: minutes / 60 });
}

/** The gate is "Portaria" (the museum's map calls it the reception); other POIs by name. */
function nameOf(poi) {
  return poi.id === app.data.defaults.start ? t("gate") : poi.name;
}

function buildForm() {
  const s = app.state;
  $(`#from input[value="${s.from}"]`).checked = true;
  $(`#see input[value="${s.see}"]`).checked = true;
  $("#start-time").value = s.startTime;
  renderStepper();
  renderChips();
}

function renderStepper() {
  const budgets = settings.BUDGETS;
  const index = budgets.indexOf(app.state.budgetMin);
  $("#budget").textContent = budgetLabel(app.state.budgetMin);
  $("#less").disabled = index <= 0;
  $("#more").disabled = index >= budgets.length - 1;
}

function renderChips() {
  const chips = app.state.must
    .map((id) => app.park.byId.get(id))
    .filter(Boolean)
    .map((poi) =>
      h(
        "li",
        { class: "chip" },
        h("span", {}, poi.name),
        h(
          "button",
          {
            type: "button",
            "aria-label": t("remove", { name: poi.name }),
            onclick: () => unmakeMust(poi.id),
          },
          icon(CLOSE_ICON),
        ),
      ),
    );
  $("#must-chips").replaceChildren(...chips);
}

function renderResults() {
  const input = $("#must-search");
  const list = $("#must-results");
  const query = input.value;
  if (!query.trim()) {
    list.hidden = true;
    list.replaceChildren();
    return;
  }
  const start = app.data.defaults.start;
  const matches = app.park
    .search(query)
    .filter((poi) => poi.node !== null && poi.id !== start && !app.state.must.includes(poi.id))
    .slice(0, SEARCH_LIMIT);
  const choose = (poi) => {
    input.value = "";
    renderResults();
    makeMust(poi.id);
    input.focus();
  };
  list.replaceChildren(
    ...(matches.length
      ? matches.map((poi) =>
          h(
            "li",
            {},
            h(
              "button",
              { type: "button", onclick: () => choose(poi) },
              poi.name,
              h("small", {}, t(`kind.${poi.kind}`)),
            ),
          ),
        )
      : [h("li", { class: "empty" }, t("noMatches"))]),
  );
  list.hidden = false;
}

// ----------------------------------------------------------------------------- results

function startMinutes() {
  return parseClock(app.state.startTime) ?? 570;
}

function render() {
  renderHero();
  renderNotices(app.plan);
  if (!app.plan) {
    $("#itinerary").replaceChildren();
    renderExtras(null);
    return;
  }
  renderItinerary(app.plan);
  renderExtras(app.plan);
}

function renderHero() {
  if (app.locating) {
    $("#meta").textContent = t("locating");
    return;
  }
  const plan = app.plan;
  if (!plan) {
    $("#total").textContent = "—";
    $("#meta").textContent = app.error ?? "";
    $("#clock").hidden = true;
    return;
  }
  $("#total").textContent = duration(plan.totalS);
  $("#meta").textContent = [
    t("stops", { n: plan.visits.length - 2 }),
    t("walking", { distance: distance(plan.walkM, lang()) }),
  ].join(" · ");
  const end = clock(startMinutes(), plan.totalS);
  $("#end-time").textContent = end;
  $("#end-time").setAttribute("aria-label", t("endsAt", { time: end }));
  $("#clock").hidden = false;
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
  if (plan && !plan.feasible) {
    const budget = budgetLabel(app.state.budgetMin);
    notes.push(["warn", t("infeasible", { budget, total: duration(plan.totalS) })]);
  }
  if (plan?.unreachable.length) {
    const names = plan.unreachable.map((poi) => poi.name).join(", ");
    notes.push(["info", t("unreachable", { names })]);
  }
  $("#notices").replaceChildren(
    ...notes.map(([kind, text]) => h("p", { class: `notice notice--${kind}` }, text)),
  );
}

function renderItinerary(plan) {
  const start = startMinutes();
  const last = plan.visits.length - 1;
  const must = new Set(app.state.must);
  const items = plan.visits.map((visit, index) => {
    const ends = index === 0 || index === last;
    let name;
    let meta;
    if (ends) {
      name = visit.poi ? nameOf(visit.poi) : t("youAreHere");
      meta = index === 0 ? t("start") : t("finish");
    } else {
      const minutes = t("minutesHere", { min: Math.round(visit.dwellS / 60) });
      name = [h("span", { class: "visually-hidden" }, `${index}. `), visit.poi.name];
      meta = [t(`kind.${visit.poi.kind}`), minutes, ...visit.poi.artists].join(" · ");
      if (must.has(visit.poi.id)) {
        name.push(
          h(
            "span",
            { class: "star" },
            h("span", { "aria-hidden": "true" }, " ★"),
            h("span", { class: "visually-hidden" }, ` (${t("mustSee")})`),
          ),
        );
      }
    }
    const badge = h(
      "span",
      { class: ends ? "badge badge--end" : "badge", "aria-hidden": "true" },
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
      h("span", { class: "stop__time" }, clock(start, visit.arriveS)),
    );
    const walk = index > 0 ? h("p", { class: "walk" }, walkLabel(visit)) : null;
    return h("li", { class: "stop", "data-index": String(index) }, walk, row);
  });
  $("#itinerary").replaceChildren(...items);
}

/** How far to the next stop. No minutes: walking pace is a guess (state.js). */
function walkLabel(visit) {
  return visit.walkM < 20 ? t("nextDoor") : distance(visit.walkM, lang());
}

function renderExtras(plan) {
  const blocks = [];
  const block = (key, title, pois, action) =>
    h(
      "details",
      {
        class: "extra",
        open: app.open[key] ?? null,
        ontoggle: (event) => (app.open[key] = event.target.open),
      },
      h("summary", {}, title),
      h(
        "ul",
        {},
        pois.map((poi) =>
          h(
            "li",
            {},
            h("span", {}, poi.name, h("small", {}, t(`kind.${poi.kind}`))),
            action(poi),
          ),
        ),
      ),
    );
  if (plan?.skipped.length) {
    const title = t("leftOut", { n: plan.skipped.length });
    const add = (poi) => chip(t("add"), () => makeMust(poi.id));
    blocks.push(block("leftOut", title, plan.skipped, add));
  }
  const excluded = app.state.exclude.map((id) => app.park.byId.get(id)).filter(Boolean);
  if (excluded.length) {
    const title = t("skippedByYou", { n: excluded.length });
    const back = (poi) => chip(t("restore"), () => restore(poi.id));
    blocks.push(block("skipped", title, excluded, back));
  }
  $("#extras").replaceChildren(...blocks);
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
  box.append(h("strong", {}, isStop ? `${at}. ${nameOf(poi)}` : nameOf(poi)));
  box.append(h("p", {}, [t(`kind.${poi.kind}`), ...poi.artists].join(" · ")));
  if (isStop) {
    const start = startMinutes();
    const from = clock(start, visit.arriveS);
    const to = clock(start, visit.arriveS + visit.dwellS);
    box.append(h("p", {}, `${from}–${to}`));
  }
  const actions = h("div", { class: "popup__actions" });
  const must = app.state.must.includes(poi.id);
  const excluded = app.state.exclude.includes(poi.id);
  if (!ends && poi.id !== app.data.defaults.start) {
    if (excluded) {
      actions.append(chip(t("restore"), () => restore(poi.id), true));
    } else if (must) {
      actions.append(chip(t("removeMust"), () => unmakeMust(poi.id)));
    } else {
      actions.append(chip(`★ ${t("addMust")}`, () => makeMust(poi.id), true));
      if (isStop) actions.append(chip(t("skip"), () => skip(poi.id)));
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

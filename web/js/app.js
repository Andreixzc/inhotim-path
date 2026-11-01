// The planner page: the form, the itinerary and the map, wired together. Routes are planned in a
// worker (worker.js) so the page stays responsive; where workers can't start, on the main thread.

import { clock, distance, duration, nowRounded, parseClock } from "./format.js";
import { detect, lang, setLang, t } from "./i18n.js";
import { KIND_COLOR, RouteMap } from "./map.js";
import { Park } from "./plan.js";
import * as settings from "./state.js";

const DATA_URL = "data/park.json";
const LANG_KEY = "inhotim-path-lang";
const SEARCH_LIMIT = 8;
const BUSY_AFTER_MS = 150;

const $ = (selector) => document.querySelector(selector);

/** A DOM element: `h("a", {href, class, onclick}, "text", child)`. Text is never parsed as HTML. */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
    else if (name === "class") element.className = value;
    else if (name === "style") Object.assign(element.style, value);
    else element.setAttribute(name, value === true ? "" : value);
  }
  element.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return element;
}

/** A small button that does `action` when pressed. */
function button(label, action, className = "small") {
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
  plan: null,
  error: null, // why there is no plan
  notice: null, // a one-off message (location problems)
  latest: 0,
  timer: 0,
  open: {}, // which "left out" lists are expanded
};

// ----------------------------------------------------------------------------- start up

async function main() {
  setLang(detect(storage(LANG_KEY), navigator.languages ?? [navigator.language]));
  translatePage();
  $("#summary").textContent = t("loading");
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(String(response.status));
    app.data = await response.json();
  } catch {
    $("#summary").textContent = t("loadError");
    return;
  }
  app.park = new Park(app.data);
  app.planner = new Planner(app.data, app.park);
  app.state = settings.load(app.data.defaults, location.hash);
  buildForm();
  renderFooter();
  wireEvents();
  RouteMap.create($("#map"), {
    pois: app.data.pois,
    satelliteKey: app.data.config?.maptiler_key ?? null,
  }).then((map) => {
    app.map = map;
    map.describe = describe;
    map.onPick = highlight;
    showOnMap(true);
  });
  await replan({ fit: true });
}

function wireEvents() {
  const form = $("#form");
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("change", onFormChange);
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
    app.map?.translate();
    render();
  });
  $("#sheet").addEventListener("click", () => {
    document.body.classList.toggle("collapsed");
    labelSheetToggle();
    requestAnimationFrame(() => app.map?.resize());
  });
  addEventListener("hashchange", () => {
    if (location.hash === `#${settings.toHash(app.state)}`) return;
    app.state = settings.load(app.data.defaults, location.hash);
    buildForm();
    changed({ fit: true });
  });
}

// ----------------------------------------------------------------------------- planning

function request() {
  const s = app.state;
  return {
    kinds: s.kinds,
    must: s.must,
    exclude: s.exclude,
    budgetMin: s.budgetMin,
    speedKmh: settings.PACES[s.pace],
    dwellMin: s.dwellMin,
    start: s.from === "here" && app.here ? app.here : undefined,
  };
}

/** The settings changed: remember them, and plan again shortly (typing doesn't plan each key). */
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
      const away = distance(app.park.network.snap(app.here).distance, lang());
      locationFailed(t("farAway", { distance: away }));
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
    locationFailed(t("geoFailed"));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      app.here = [position.coords.longitude, position.coords.latitude];
      app.notice = null;
      app.state.startTime = nowRounded();
      $("#start-time").value = app.state.startTime;
      changed({ fit: true, now: true });
    },
    () => locationFailed(t("geoFailed")),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

function locationFailed(message) {
  app.here = null;
  app.notice = message;
  app.state.from = "reception";
  $('#from input[value="reception"]').checked = true;
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
  for (const item of document.querySelectorAll(".visit.is-picked")) {
    item.classList.remove("is-picked");
  }
  const item = document.querySelector(`.visit[data-index="${index}"]`);
  if (!item) return;
  item.classList.add("is-picked");
  item.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function onFormChange(event) {
  const s = app.state;
  const target = event.target;
  switch (target.name) {
    case "budget":
      s.budgetMin = target.value === "all" ? null : Number(target.value);
      changed({ fit: true });
      break;
    case "startTime":
      if (parseClock(target.value) !== null) {
        s.startTime = target.value;
        settings.save(s);
        history.replaceState(null, "", `#${settings.toHash(s)}`);
        render(); // times of day only: no need to plan again
      }
      break;
    case "from":
      s.from = target.value;
      if (s.from === "here") {
        locate();
      } else {
        app.here = null;
        changed({ fit: true });
      }
      break;
    case "kind":
      s.kinds = [...document.querySelectorAll('input[name="kind"]:checked')].map((b) => b.value);
      changed({ fit: true });
      break;
    case "pace":
      s.pace = target.value;
      changed();
      break;
    case "dwell": {
      const minutes = Number(target.value);
      if (target.value === "" || !(minutes >= 0 && minutes <= 240)) return;
      if (minutes === app.data.defaults.dwell_min[target.dataset.kind]) {
        delete s.dwellMin[target.dataset.kind];
      } else {
        s.dwellMin[target.dataset.kind] = minutes;
      }
      changed();
      break;
    }
  }
}

// ----------------------------------------------------------------------------- form

function translatePage() {
  document.documentElement.lang = lang();
  document.title = t("title");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  $("#lang").textContent = t("language");
  labelSheetToggle();
}

function labelSheetToggle() {
  const collapsed = document.body.classList.contains("collapsed");
  $("#sheet").textContent = collapsed ? t("showPlan") : t("hidePlan");
  $("#sheet").setAttribute("aria-expanded", String(!collapsed));
}

function budgetLabel(minutes) {
  if (minutes === null) return t("everything");
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  if (hours === 0) return `${rest} min`;
  if (!rest) return t("hours", { h: hours });
  return t("hoursMinutes", { h: hours, m: String(rest).padStart(2, "0") });
}

function buildForm() {
  const s = app.state;
  const budgets = settings.BUDGETS.includes(s.budgetMin)
    ? settings.BUDGETS
    : [...settings.BUDGETS, s.budgetMin]; // an unusual budget from a shared link
  $("#budget").replaceChildren(
    ...budgets.map((minutes) =>
      h(
        "option",
        { value: minutes === null ? "all" : String(minutes), selected: minutes === s.budgetMin },
        budgetLabel(minutes),
      ),
    ),
  );
  $("#start-time").value = s.startTime;
  $(`#from input[value="${s.from}"]`).checked = true;

  const counts = {};
  for (const poi of app.data.pois) {
    if (poi.main_view && poi.node !== null) counts[poi.kind] = (counts[poi.kind] ?? 0) + 1;
  }
  $("#kinds").replaceChildren(
    ...settings.KINDS.filter((kind) => counts[kind]).map((kind) =>
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "checkbox",
          name: "kind",
          value: kind,
          checked: s.kinds.includes(kind),
        }),
        h("span", { class: "dot", style: { background: KIND_COLOR[kind] } }),
        h("span", {}, t(`kinds.${kind}`), " ", h("small", {}, `(${counts[kind]})`)),
      ),
    ),
  );
  $("#pace").replaceChildren(
    ...Object.keys(settings.PACES).map((pace) =>
      h("option", { value: pace, selected: pace === s.pace }, t(pace)),
    ),
  );
  $("#dwell").replaceChildren(
    ...settings.KINDS.map((kind) =>
      h(
        "label",
        { class: "dwell-field" },
        h("span", {}, t(`kinds.${kind}`)),
        h("input", {
          type: "number",
          name: "dwell",
          "data-kind": kind,
          min: "0",
          max: "240",
          step: "1",
          inputmode: "numeric",
          value: String(s.dwellMin[kind] ?? app.data.defaults.dwell_min[kind]),
        }),
      ),
    ),
  );
  renderChips();
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
          "×",
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
              h("span", {}, poi.name),
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
  const plan = app.plan;
  renderNotices(plan);
  if (!plan) {
    $("#summary").textContent = app.error ?? "";
    $("#itinerary").replaceChildren();
    renderExtras(null);
    return;
  }
  const stops = t("stops", { n: plan.visits.length - 2 });
  $("#summary").textContent =
    t("summary", {
      stops,
      total: duration(plan.totalS),
      walk: distance(plan.walkM, lang()),
      walkTime: duration(plan.walkS),
    }) + ` · ${t("endsAt", { time: clock(startMinutes(), plan.totalS) })}`;
  renderItinerary(plan);
  renderExtras(plan);
}

function renderNotices(plan) {
  const notes = [];
  if (app.notice) notes.push(["info", app.notice]);
  if (app.error) notes.push(["warn", app.error]);
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

function endLabel(visit, index, last) {
  if (index === 0) return visit.poi ? `${t("start")}: ${visit.poi.name}` : t("youAreHere");
  return index === last ? `${t("finish")}: ${visit.poi.name}` : visit.poi.name;
}

function officialLink(poi, compact) {
  if (!/^https?:\/\//i.test(poi?.url ?? "")) return null;
  return h(
    "a",
    {
      href: poi.url,
      target: "_blank",
      rel: "noopener",
      class: compact ? "icon-link" : null,
      "aria-label": compact ? `${t("officialPage")}: ${poi.name}` : null,
    },
    compact ? "↗" : `${t("officialPage")} ↗`,
  );
}

function renderItinerary(plan) {
  const start = startMinutes();
  const last = plan.visits.length - 1;
  const must = new Set(app.state.must);
  const items = plan.visits.map((visit, index) => {
    const ends = index === 0 || index === last;
    const walk = index > 0 ? h("p", { class: "walk" }, walkLabel(visit)) : null;
    const badge = h(
      "button",
      {
        type: "button",
        class: ends ? "badge badge--end" : "badge",
        style: ends ? null : { background: KIND_COLOR[visit.poi.kind] ?? KIND_COLOR.other },
        "aria-label": endLabel(visit, index, last),
        onclick: () => pick(index),
      },
      ends ? "⚑" : String(index),
    );
    const name = button(endLabel(visit, index, last), () => pick(index), "name");
    const time = clock(start, visit.arriveS);
    const title = h("p", { class: "visit__title" }, h("span", { class: "time" }, time), " ", name);
    if (!ends && must.has(visit.poi.id)) {
      title.append(" ", h("span", { class: "tag" }, t("mustSee")));
    }
    const minutes = t("minutesHere", { min: Math.round(visit.dwellS / 60) });
    const details = ends
      ? null
      : h(
          "p",
          { class: "visit__meta" },
          [t(`kind.${visit.poi.kind}`), minutes, ...visit.poi.artists].join(" · "),
        );
    const actions = ends
      ? null
      : h(
          "div",
          { class: "visit__actions" },
          officialLink(visit.poi, true),
          must.has(visit.poi.id) ? null : button(t("skip"), () => skip(visit.poi.id)),
        );
    const main = h("div", { class: "visit__main" }, title, details);
    return h(
      "li",
      { class: ends ? "visit visit--end" : "visit", "data-index": String(index) },
      walk,
      h("div", { class: "visit__row" }, badge, main, actions),
    );
  });
  $("#itinerary").replaceChildren(...items);
}

function walkLabel(visit) {
  if (visit.walkM < 20) return t("nextDoor");
  return t("walkLeg", { time: duration(visit.walkS), distance: distance(visit.walkM, lang()) });
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
        pois.map((poi) => {
          const name = h("span", {}, poi.name, " ", h("small", {}, t(`kind.${poi.kind}`)));
          return h("li", {}, name, action(poi));
        }),
      ),
    );
  if (plan?.skipped.length) {
    const title = t("leftOut", { n: plan.skipped.length });
    const add = (poi) => button(t("add"), () => makeMust(poi.id));
    blocks.push(block("leftOut", title, plan.skipped, add));
  }
  const excluded = app.state.exclude.map((id) => app.park.byId.get(id)).filter(Boolean);
  if (excluded.length) {
    const title = t("skippedByYou", { n: excluded.length });
    const back = (poi) => button(t("restore"), () => restore(poi.id));
    blocks.push(block("skipped", title, excluded, back));
  }
  $("#extras").replaceChildren(...blocks);
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
  box.append(h("strong", {}, isStop ? `${at}. ${poi.name}` : poi.name));
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
      actions.append(button(t("restore"), () => restore(poi.id)));
    } else if (must) {
      actions.append(button(t("removeMust"), () => unmakeMust(poi.id)));
    } else {
      actions.append(button(t("addMust"), () => makeMust(poi.id)));
      if (isStop) actions.append(button(t("skip"), () => skip(poi.id)));
    }
  }
  const link = officialLink(poi, false);
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

// What the visitor asked for, and how it's kept: the shareable part goes in the URL
// (#s=gallery,garden&...), everything in localStorage. Pure functions apart from `load`/`save`:
// also tested under node.
//
// No times and no time limit (ADR 0010): the page plans the shortest walk through what's chosen.
// What's chosen is a set of the museum's own categories, plus stops added or skipped one by one
// (ADR 0012).

/** The categories a visitor can choose, as on Inhotim's map, in the order the page lists them. */
export const KINDS = ["gallery", "outdoor_work", "garden", "botanical"];
/** At first, everything but the botanical highlights (single plants) (ADR 0011). */
const DEFAULT_KINDS = ["gallery", "outdoor_work", "garden"];
/** Links from before the categories could be chosen one by one. */
const PRESETS = { galleries: ["gallery"], all: DEFAULT_KINDS };
const STORAGE_KEY = "inhotim-path";

export function defaults() {
  return {
    from: "gate", // or "here": the visitor's position (never shared in links)
    kinds: [...DEFAULT_KINDS],
    must: [], // stops added to what `kinds` cover
    exclude: [], // stops skipped
  };
}

/** Whether the chosen categories put this POI on the route (works inside galleries never do). */
export function covers(state, poi) {
  return poi.main_view && state.kinds.includes(poi.kind);
}

/** Whether this POI is on the route with these settings. */
export function isChosen(state, poi) {
  return state.must.includes(poi.id) || (covers(state, poi) && !state.exclude.includes(poi.id));
}

/** Put a POI on the route, or take it off. Only what differs from the categories is kept. */
export function setStop(state, poi, on) {
  state.must = state.must.filter((id) => id !== poi.id);
  state.exclude = state.exclude.filter((id) => id !== poi.id);
  if (on !== covers(state, poi)) (on ? state.must : state.exclude).push(poi.id);
}

/** Choose a whole category, or none of it: its stops added or skipped one by one are forgotten. */
export function setKind(state, kind, on, pois) {
  state.kinds = KINDS.filter((k) => (k === kind ? on : state.kinds.includes(k)));
  const ofKind = new Set(pois.filter((poi) => poi.kind === kind).map((poi) => poi.id));
  state.must = state.must.filter((id) => !ofKind.has(id));
  state.exclude = state.exclude.filter((id) => !ofKind.has(id));
}

/** The shareable part of the state, as a URL fragment (without "#"). */
export function toHash(state) {
  const params = new URLSearchParams();
  params.set("s", state.kinds.join(","));
  if (state.must.length) params.set("m", state.must.join(","));
  if (state.exclude.length) params.set("x", state.exclude.join(","));
  return params.toString().replaceAll("%2C", ",");
}

/** `base` updated with whatever valid settings the fragment has. Junk is ignored. */
export function fromHash(hash, base) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const state = structuredClone(base);
  const ids = (text) => text.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (params.has("s")) {
    const text = params.get("s");
    if (Object.hasOwn(PRESETS, text)) {
      state.kinds = [...PRESETS[text]];
    } else {
      const named = new Set(text.split(","));
      const kinds = KINDS.filter((kind) => named.has(kind));
      if (kinds.length || text === "") state.kinds = kinds; // "s=" means none
    }
  }
  if (params.has("m")) state.must = ids(params.get("m"));
  if (params.has("x")) state.exclude = ids(params.get("x"));
  return state;
}

/** Saved settings (or the defaults), then whatever a shared link says. */
export function load(hash) {
  let state = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") state = fromHash(saved.hash ?? "", state);
  } catch {
    // Private mode or blocked storage: start from the defaults.
  }
  return hash ? fromHash(hash, state) : state;
}

export function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hash: toHash(state) }));
  } catch {
    // Not essential: the URL still has the settings.
  }
}

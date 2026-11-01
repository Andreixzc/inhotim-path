// What the visitor asked for, and how it's kept: the shareable part goes in the URL (#s=all&...),
// everything in localStorage. Pure functions apart from `load`/`save`: also tested under node.
//
// No times and no time limit (ADR 0010): how long a visit takes is up to the visitor, so the page
// only plans the shortest walk through what they want to see.

/** What to see: the kinds of stop behind each choice. */
export const SEE = {
  galleries: ["gallery"],
  all: ["gallery", "outdoor_work", "garden", "botanical"],
};
const STORAGE_KEY = "inhotim-path";

export function defaults() {
  return {
    from: "gate", // or "here": the visitor's position (never shared in links)
    see: "all",
    must: [], // stops added to what `see` covers
    exclude: [], // stops skipped
  };
}

/** The shareable part of the state, as a URL fragment (without "#"). */
export function toHash(state) {
  const params = new URLSearchParams();
  params.set("s", state.see);
  if (state.must.length) params.set("m", state.must.join(","));
  if (state.exclude.length) params.set("x", state.exclude.join(","));
  return params.toString().replaceAll("%2C", ",");
}

/** `base` updated with whatever valid settings the fragment has. Junk is ignored. */
export function fromHash(hash, base) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const state = structuredClone(base);
  const ids = (text) => text.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (Object.hasOwn(SEE, params.get("s") ?? "")) state.see = params.get("s");
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

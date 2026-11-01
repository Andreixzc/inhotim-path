// What the visitor asked for, and how it's kept: the shareable part goes in the URL (#b=240&...),
// everything in localStorage. Pure functions apart from `load`/`save`: also tested under node.
//
// Walking pace and minutes per stop aren't settings: they're guesses about a person, so the page
// uses the park's defaults (4 km/h, minutes per kind) and only asks what a visitor knows.

/** Time available, in minutes; null = no limit: the shortest walk through everything chosen. */
export const BUDGETS = [60, 120, 180, 240, 300, 360, 420, 480, null];
/** What to see: the kinds of stop behind each choice. */
export const SEE = {
  galleries: ["gallery"],
  all: ["gallery", "outdoor_work", "garden", "botanical"],
};
const STORAGE_KEY = "inhotim-path";

export function defaults() {
  return {
    budgetMin: 360,
    startTime: "09:30",
    from: "gate", // or "here": the visitor's position (never shared in links)
    see: "all",
    must: [],
    exclude: [],
  };
}

/** The shareable part of the state, as a URL fragment (without "#"). */
export function toHash(state) {
  const params = new URLSearchParams();
  params.set("b", state.budgetMin === null ? "all" : String(state.budgetMin));
  params.set("t", state.startTime.replace(":", ""));
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
  if (params.has("b")) {
    const b = params.get("b");
    const budget = b === "all" ? null : Number(b);
    if (BUDGETS.includes(budget)) state.budgetMin = budget;
  }
  if (/^\d{4}$/.test(params.get("t") ?? "")) {
    const t = params.get("t");
    if (Number(t.slice(0, 2)) < 24 && Number(t.slice(2)) < 60) {
      state.startTime = `${t.slice(0, 2)}:${t.slice(2)}`;
    }
  }
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

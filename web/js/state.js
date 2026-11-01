// What the visitor asked for, and how it's kept: the shareable part goes in the URL (#b=240&...),
// everything in localStorage. Pure functions apart from `load`/`save`: also tested under node.

export const BUDGETS = [60, 90, 120, 180, 240, 300, 360, 420, 480, null]; // minutes; null = all
export const PACES = { relaxed: 3, normal: 4, brisk: 5 }; // km/h
export const KINDS = ["gallery", "outdoor_work", "garden", "botanical"]; // offered as checkboxes
const STORAGE_KEY = "inhotim-path";

export function defaults(parkDefaults) {
  return {
    budgetMin: 360,
    startTime: "09:30",
    from: "reception", // or "here": the visitor's position (never shared in links)
    kinds: parkDefaults.kinds.filter((kind) => KINDS.includes(kind)),
    must: [],
    exclude: [],
    pace: "normal",
    dwellMin: {}, // overrides of the park's minutes per kind
  };
}

/** The shareable part of the state, as a URL fragment (without "#"). */
export function toHash(state) {
  const params = new URLSearchParams();
  params.set("b", state.budgetMin === null ? "all" : String(state.budgetMin));
  params.set("t", state.startTime.replace(":", ""));
  params.set("k", state.kinds.join(","));
  if (state.must.length) params.set("m", state.must.join(","));
  if (state.exclude.length) params.set("x", state.exclude.join(","));
  if (state.pace !== "normal") params.set("p", state.pace);
  const dwell = Object.entries(state.dwellMin).map(([kind, minutes]) => `${kind}:${minutes}`);
  if (dwell.length) params.set("d", dwell.join(","));
  return params.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
}

/** `base` updated with whatever valid settings the fragment has. Junk is ignored. */
export function fromHash(hash, base) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const state = structuredClone(base);
  const ids = (text) => text.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (params.has("b")) {
    const b = params.get("b");
    const budget = b === "all" ? null : Number(b);
    if (budget === null || (Number.isFinite(budget) && budget > 0 && budget <= 24 * 60)) {
      state.budgetMin = budget;
    }
  }
  if (/^\d{4}$/.test(params.get("t") ?? "")) {
    const t = params.get("t");
    if (Number(t.slice(0, 2)) < 24 && Number(t.slice(2)) < 60) {
      state.startTime = `${t.slice(0, 2)}:${t.slice(2)}`;
    }
  }
  if (params.has("k")) state.kinds = params.get("k").split(",").filter((k) => /^[a-z_]+$/.test(k));
  if (params.has("m")) state.must = ids(params.get("m"));
  if (params.has("x")) state.exclude = ids(params.get("x"));
  if (params.get("p") in PACES) state.pace = params.get("p");
  if (params.has("d")) {
    state.dwellMin = {};
    for (const item of params.get("d").split(",")) {
      const [kind, minutes] = item.split(":");
      if (/^[a-z_]+$/.test(kind) && Number(minutes) >= 0 && Number(minutes) <= 600) {
        state.dwellMin[kind] = Number(minutes);
      }
    }
  }
  return state;
}

/** Saved settings (or the defaults), then whatever a shared link says. */
export function load(parkDefaults, hash) {
  let state = defaults(parkDefaults);
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

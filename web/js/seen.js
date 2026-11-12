// Stops a visitor has marked as seen (ADR 0018). They're kept on the phone until the visitor
// clears them, and never put in shared links. A seen stop leaves the route, and the map shows it
// faded with a check. During a visit, the route goes on from the last stop marked seen that day,
// unless the visitor picks the Portaria or their position. While their position is known, a stop
// they stay near for a while is suggested (`Linger`). Pure apart from `load` and `save`: also
// tested under node.

const STORAGE_KEY = "inhotim-path-seen";

/**
 * The marks: `[poi id, when (ms)]`, oldest first. `restart` is when the visitor last chose to
 * start at the Portaria: marks from before it no longer move the start.
 * @typedef {{marks: Array<[number, number]>, restart: number}} Seen
 */

/** @returns {Seen} */
export function empty() {
  return { marks: [], restart: 0 };
}

/** The ids of the stops seen, oldest first. */
export function ids(seen) {
  return seen.marks.map(([id]) => id);
}

export function has(seen, id) {
  return seen.marks.some(([marked]) => marked === id);
}

/** Mark a stop as seen at `now`. Marking it again makes it the latest. */
export function mark(seen, id, now) {
  return { ...seen, marks: [...unmark(seen, id).marks, [id, now]] };
}

export function unmark(seen, id) {
  return { ...seen, marks: seen.marks.filter(([marked]) => marked !== id) };
}

/** From `now` on, start at the Portaria: earlier marks no longer move the start. */
export function restart(seen, now) {
  return { ...seen, restart: now };
}

/**
 * Where the visit goes on from: the stop marked seen last, if that was today and since the last
 * restart. Otherwise null: start at the Portaria. On another day, a two-day visit starts there
 * again.
 */
export function continueFrom(seen, now) {
  const last = seen.marks.at(-1);
  if (!last || last[1] < seen.restart) return null;
  return new Date(last[1]).toDateString() === new Date(now).toDateString() ? last[0] : null;
}

/** The marks kept on this phone, without stops that `known(id)` lacks (the data changes). */
export function load(known) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parse(saved, known);
  } catch {
    return empty(); // private mode or blocked storage
  }
}

/** Saved marks, checked: anything malformed is dropped. */
export function parse(saved, known) {
  const seen = empty();
  if (!saved || !Array.isArray(saved.marks)) return seen;
  for (const entry of saved.marks) {
    if (!Array.isArray(entry)) continue;
    const [id, at] = entry;
    if (Number.isInteger(id) && Number.isFinite(at) && known(id) && !has(seen, id)) {
      seen.marks.push([id, at]);
    }
  }
  if (Number.isFinite(saved.restart)) seen.restart = saved.restart;
  return seen;
}

export function save(seen) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // Not essential: the marks just won't outlive the page.
  }
}

// ----------------------------------------------------------------------------- suggestions

/**
 * When a stop is suggested: the visitor came within `near` m of it and stayed within `away` m for
 * `ms`. Fixes vaguer than `accuracy` m don't count either way (GPS drifts inside galleries).
 */
export const LINGER = { near: 40, away: 70, ms: 2 * 60 * 1000, accuracy: 60 };

/** Meters between two `[lng, lat]` points, close enough for a park. */
export function metersBetween([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.hypot(x, y) * 6371008.8;
}

/** Suggests a stop as seen once the visitor has stayed near it for a while: each stop once. */
export class Linger {
  constructor() {
    this.at = null; // the stop the visitor is near: {id, since}
    this.suggested = new Set();
  }

  /**
   * A new position. Returns the id of a stop to suggest now, or null.
   * @param {{lnglat: [number, number], accuracy: number, time: number}} fix
   * @param {Array<{id: number, lnglat: [number, number]}>} stops  the route's stops not seen yet
   */
  update(fix, stops) {
    if (!(fix.accuracy <= LINGER.accuracy)) return null;
    const distance = (stop) => metersBetween(fix.lnglat, stop.lnglat);
    const current = this.at && stops.find((stop) => stop.id === this.at.id);
    if (!current || distance(current) > LINGER.away) {
      // Walked off (or it was seen): look for the nearest stop within reach.
      this.at = null;
      let best = LINGER.near;
      for (const stop of stops) {
        const meters = distance(stop);
        if (meters <= best) {
          best = meters;
          this.at = { id: stop.id, since: fix.time };
        }
      }
      return null;
    }
    if (this.suggested.has(current.id) || fix.time - this.at.since < LINGER.ms) return null;
    this.suggested.add(current.id);
    return current.id;
  }
}

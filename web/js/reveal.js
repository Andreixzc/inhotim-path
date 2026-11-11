// The map's "finding the route" animation (ADR 0014), as geometry and timing only: no DOM, so it
// is also tested under node. The route is already planned when it starts (in about 40 ms); the
// animation shows how it's found, slowed down so it can be seen:
//
// 1. a search wave spreads from the start along every path of the park, the way the shortest-path
//    search really does. Its front blinks, and the whole network flashes once when it's done;
// 2. the route is drawn from the start to the finish, and each stop appears when the line gets there.

/** When each part runs, in milliseconds from the start. */
export const TIMING = {
  fadeOld: 250, // the previous route fades out
  wave: 560, // the wave reaches the farthest path
  traceFrom: 520, // the route starts drawing just before the wave is done
  trace: 760,
};
export const DURATION = TIMING.traceFrom + TIMING.trace;
/** The wave's blinking front: the last part of what it reached, as a share of the park's depth. */
export const HEAD = 0.12;

/** Each path of the network as a polyline, with the meters along it at each of its points. */
export function paths({ nodes, edges }) {
  return edges.map(([u, v, meters, interior]) => {
    const points = [nodes[u], ...interior, nodes[v]];
    return { u, v, meters, points, along: lengths(points, meters) };
  });
}

/**
 * The wave from a shortest-path tree (`dist`: meters to each node). For each path: how far the
 * search had gone when it reached either end (`from` at u, `to` at v), and where the two fronts
 * meet on it (`meet`, in meters from u). `depth` is how far the wave goes in all.
 */
export function wave(paths, dist) {
  let depth = 0;
  const reach = paths.map(({ u, v, meters }) => {
    const from = dist[u];
    const to = dist[v];
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null; // not on the network
    const meet = clamp((to - from + meters) / 2, 0, meters);
    depth = Math.max(depth, from + meet);
    return { from, to, meet };
  });
  return { reach, depth };
}

/**
 * The parts of a path the wave has reached when its front is `front` meters from the start, and no
 * more than `behind` meters behind the front: up to two polylines, one from each end.
 */
export function reached(path, reach, front, behind = Infinity) {
  if (reach === null) return [];
  const pieces = [];
  const near = Math.min(front - reach.from, reach.meet);
  const nearFrom = Math.max(front - behind - reach.from, 0);
  if (near > nearFrom) pieces.push(slice(path.points, path.along, nearFrom, near));
  const far = Math.min(front - reach.to, path.meters - reach.meet);
  const farFrom = Math.max(front - behind - reach.to, 0);
  if (far > farFrom) {
    pieces.push(slice(path.points, path.along, path.meters - far, path.meters - farFrom));
  }
  return pieces;
}

/** The route as one line: its points, the meters along it, and where on it each visit is. */
export function routeLine(legs) {
  const points = [];
  const ends = [];
  for (const leg of legs) {
    for (const point of leg) {
      const last = points.at(-1);
      if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
    }
    ends.push(points.length - 1);
  }
  const along = lengths(points);
  return {
    points,
    along,
    length: along.at(-1) ?? 0,
    visits: [0, ...ends.map((i) => along[i] ?? 0)], // visit k is reached at the end of leg k - 1
  };
}

/** The part of a polyline between `from` and `to` meters along it (`along`: meters at each point). */
export function slice(points, along, from, to) {
  const out = [];
  for (let i = 1; i < points.length && along[i - 1] <= to; i++) {
    if (along[i] < from) continue;
    if (out.length === 0) out.push(pointAt(points, along, i, Math.max(from, along[i - 1])));
    out.push(along[i] <= to ? points[i] : pointAt(points, along, i, to));
  }
  return out;
}

/**
 * Where the animation is `elapsed` ms after it starts: the previous route's opacity (`old`), the
 * wave's reach as a share of its depth (`front`), the opacity of the paths it reached (`glow`) and
 * their blink as the search ends (`flash`), and the share of the route drawn so far (`drawn`).
 */
export function frame(elapsed) {
  const { fadeOld, wave: waveMs, traceFrom, trace } = TIMING;
  return {
    old: 1 - clamp(elapsed / fadeOld, 0, 1),
    // At a steady pace, like the real search: it reaches places in order of their distance.
    front: clamp(elapsed / waveMs, 0, 1),
    glow: 1 - easeInOut(clamp((elapsed - traceFrom) / (trace * 0.8), 0, 1)),
    flash: Math.exp(-(((elapsed - waveMs) / 70) ** 2)),
    drawn: easeInOut(clamp((elapsed - traceFrom) / trace, 0, 1)),
    searching: elapsed < traceFrom,
    done: elapsed >= DURATION,
  };
}

/** The end state, when the animation is skipped or cut short. */
export const FINISHED = Object.freeze({
  old: 0,
  front: 1,
  glow: 0,
  flash: 0,
  drawn: 1,
  searching: false,
  done: true,
});

/** How bright path `i`'s part of the wave front is: between 0.35 and 1, changing every 45 ms. */
export function flicker(i, elapsed) {
  let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(Math.floor(elapsed / 45) + 1, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x ^= x >>> 13;
  return 0.35 + 0.65 * ((x >>> 0) / 4294967296);
}

/** Two plans with the same key draw the same route: the same stops in order, from the same start. */
export function routeKey(plan) {
  return plan.visits.map((visit) => visit.poi?.id ?? visit.lnglat.join(",")).join(" ");
}

// ----------------------------------------------------------------------------- helpers

/** Meters from the first point to each point, scaled so the last one is `total` when given. */
function lengths(points, total) {
  const along = points.length > 0 ? [0] : [];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + meters(points[i - 1], points[i]));
  const length = along.at(-1) ?? 0;
  const scale = total !== undefined && length > 0 ? total / length : 1;
  return along.map((d) => d * scale);
}

/** Meters between two `[lng, lat]` points close together (like network.js's snapping). */
function meters([lng0, lat0], [lng1, lat1]) {
  const mx = 111_320 * Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
  return Math.hypot((lng1 - lng0) * mx, (lat1 - lat0) * 110_574);
}

function pointAt(points, along, i, at) {
  const [start, end] = [along[i - 1], along[i]];
  const t = end > start ? (at - start) / (end - start) : 0;
  const [a, b] = [points[i - 1], points[i]];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function clamp(x, low, high) {
  return Math.min(Math.max(x, low), high);
}

const easeInOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

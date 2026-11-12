// Route solver for the browser: the shortest walk from the start through every stop to the end,
// like the Python solver (ADR 0004).
//
// With up to `exact` stops (12 by default), dynamic programming checks every order, so the route is
// optimal. Beyond that it uses heuristics: cheapest insertion, 2-opt and or-opt, inside an iterated
// local search (ADR 0009 compares them with CP-SAT). The random choices are seeded, so the same
// input always gives the same route.

/**
 * @param {object} problem
 * @param {ArrayLike<ArrayLike<number>>} problem.cost  walking seconds between locations:
 *   0 is the start, 1..n are the stops, n + 1 is the end (it may be the same place as the start)
 * @param {number} [problem.seed]
 * @param {number} [problem.effort]  scales the heuristics' iterations (1 = default)
 * @param {number} [problem.exact]  solve exactly up to this many stops (at most 16)
 * @returns {{order: number[], walk: number}}  `order` holds stop indexes (0-based)
 */
export function solve({ cost, seed = 1, effort = 1, exact = 12 }) {
  const n = cost.length - 2;
  const ctx = {
    cost,
    end: n + 1,
    rng: mulberry32(seed),
    effort,
    exact: Math.min(exact, MAX_EXACT),
  };
  const route = shortestRoute(ctx, range(1, n + 1));
  return { order: route.slice(1, -1).map((k) => k - 1), walk: walking(cost, route) };
}

const EPSILON = 1e-6;
const MAX_EXACT = 16; // 2^16 subsets x 16 endings x 8 bytes = 8 MB

/** A route (location indexes, from 0 to the end) through all of `locations`, walking the least. */
function shortestRoute(ctx, locations) {
  if (locations.length <= ctx.exact) {
    const everything = (1 << locations.length) - 1;
    return exactRoute(ctx, locations, subsetWalks(ctx.cost, locations), everything);
  }
  return tourSearch(ctx, locations);
}

// ----------------------------------------------------------------------------- exact (small)

/**
 * Held-Karp: `walks[set * n + j]` is the shortest walk from the start through the `locations` in
 * `set` (a bit mask over their positions), ending at `locations[j]`.
 */
function subsetWalks(cost, locations) {
  const n = locations.length;
  const walks = new Float64Array((1 << n) * n).fill(Infinity);
  locations.forEach((k, j) => {
    walks[(1 << j) * n + j] = cost[0][k];
  });
  for (let set = 1; set < 1 << n; set++) {
    for (let j = 0; j < n; j++) {
      const here = walks[set * n + j]; // Infinity also when j isn't in the set
      if (here === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (set & (1 << k)) continue;
        const next = (set | (1 << k)) * n + k;
        const walk = here + cost[locations[j]][locations[k]];
        if (walk < walks[next]) walks[next] = walk;
      }
    }
  }
  return walks;
}

/** The walk through `set` to the end, and which location comes last (-1 for the empty set). */
function closeRoute(ctx, locations, walks, set) {
  const n = locations.length;
  let best = { walk: set === 0 ? ctx.cost[0][ctx.end] : Infinity, last: -1 };
  for (let j = 0; j < n; j++) {
    if (!(set & (1 << j))) continue;
    const walk = walks[set * n + j] + ctx.cost[locations[j]][ctx.end];
    if (walk < best.walk) best = { walk, last: j };
  }
  return best;
}

function exactRoute(ctx, locations, walks, set) {
  const n = locations.length;
  const route = [ctx.end];
  for (let j = closeRoute(ctx, locations, walks, set).last; j !== -1; ) {
    route.push(locations[j]);
    set &= ~(1 << j);
    let previous = -1;
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      if (!(set & (1 << k))) continue;
      const walk = walks[set * n + k] + ctx.cost[locations[k]][locations[j]];
      if (walk < best) [best, previous] = [walk, k];
    }
    j = previous;
  }
  route.push(0);
  return route.reverse();
}

// ----------------------------------------------------------------------------- tours (large)

/** Iterated local search: kick the route with a double bridge, repair it, keep it if shorter. */
function tourSearch(ctx, locations) {
  const { cost, rng } = ctx;
  let current = [0, ctx.end];
  for (const k of [...locations].sort((a, b) => cost[0][b] - cost[0][a])) {
    current.splice(cheapestInsertion(cost, current, k).position, 0, k);
  }
  localSearch(cost, current);
  let best = current;
  const iterations =
    locations.length < 4 ? 0 : Math.round(ctx.effort * (100 + 5 * locations.length));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const candidate = doubleBridge(rng, current);
    localSearch(cost, candidate);
    if (walking(cost, candidate) < walking(cost, current) + EPSILON) current = candidate;
    if (walking(cost, current) < walking(cost, best) - EPSILON) best = current;
  }
  return best;
}

/** Swap two consecutive stretches of the route: a move local search can't easily undo. */
function doubleBridge(rng, route) {
  const cuts = new Set();
  while (cuts.size < 3) cuts.add(1 + Math.floor(rng() * (route.length - 1)));
  const [a, b, c] = [...cuts].sort((x, y) => x - y);
  return [...route.slice(0, a), ...route.slice(b, c), ...route.slice(a, b), ...route.slice(c)];
}

// ----------------------------------------------------------------------------- local search

function cheapestInsertion(cost, route, k) {
  let delta = Infinity;
  let position = 1;
  for (let p = 1; p < route.length; p++) {
    const d = cost[route[p - 1]][k] + cost[k][route[p]] - cost[route[p - 1]][route[p]];
    if (d < delta) [delta, position] = [d, p];
  }
  return { delta, position };
}

/** 2-opt and or-opt until neither shortens the walk. The end points stay put. */
function localSearch(cost, route) {
  while (twoOpt(cost, route) | orOpt(cost, route));
  return route;
}

/** Reverse a stretch of the route. Exact even if walking costs differ by direction. */
function twoOpt(cost, route) {
  const m = route.length;
  const forward = new Float64Array(m);
  const backward = new Float64Array(m);
  const sums = () => {
    for (let k = 1; k < m; k++) {
      forward[k] = forward[k - 1] + cost[route[k - 1]][route[k]];
      backward[k] = backward[k - 1] + cost[route[k]][route[k - 1]];
    }
  };
  sums();
  let improved = false;
  for (let i = 1; i < m - 2; i++) {
    for (let j = i + 1; j < m - 1; j++) {
      const [a, b, c, d] = [route[i - 1], route[i], route[j], route[j + 1]];
      const delta =
        cost[a][c] +
        cost[b][d] -
        cost[a][b] -
        cost[c][d] +
        (backward[j] - backward[i]) -
        (forward[j] - forward[i]);
      if (delta < -EPSILON) {
        for (let x = i, y = j; x < y; x++, y--) [route[x], route[y]] = [route[y], route[x]];
        sums();
        improved = true;
      }
    }
  }
  return improved;
}

/** Move a run of 1 to 3 consecutive stops elsewhere, either way round. */
function orOpt(cost, route) {
  let improved = false;
  for (let length = 1; length <= 3; length++) {
    for (let i = 1; i + length < route.length; i++) {
      const j = i + length - 1;
      const [previous, first, last, next] = [route[i - 1], route[i], route[j], route[j + 1]];
      const removed = cost[previous][first] + cost[last][next] - cost[previous][next];
      let flip = 0; // extra cost of walking the run backwards
      for (let k = i; k < j; k++) {
        flip += cost[route[k + 1]][route[k]] - cost[route[k]][route[k + 1]];
      }
      for (let p = 1; p < route.length; p++) {
        if (p >= i && p <= j + 1) continue; // inside the run, or where it already is
        const [a, b] = [route[p - 1], route[p]];
        const forward = cost[a][first] + cost[last][b] - cost[a][b] - removed;
        const backward =
          length > 1 ? cost[a][last] + cost[first][b] - cost[a][b] + flip - removed : Infinity;
        if (forward < -EPSILON || backward < -EPSILON) {
          const run = route.splice(i, length);
          if (backward < forward) run.reverse();
          route.splice(p > j ? p - length : p, 0, ...run);
          improved = true;
          break;
        }
      }
    }
  }
  return improved;
}

// ----------------------------------------------------------------------------- helpers

function walking(cost, route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += cost[route[i - 1]][route[i]];
  return total;
}

function range(from, to) {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/** Small seeded PRNG (mulberry32): the same seed gives the same sequence. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

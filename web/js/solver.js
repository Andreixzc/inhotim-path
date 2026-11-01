// Route solver for the browser. Two modes, like the Python solver (ADR 0004):
//
// - no budget: visit every stop with the least walking (a path from the start to the end);
// - a budget: the stops worth the most that fit in it, then the least time (orienteering).
//
// Must-sees are always in. With up to `exact` stops (12 by default), dynamic programming checks
// every subset and order, so the route is optimal. Beyond that it uses heuristics: cheapest
// insertion, 2-opt and or-opt, inside an iterated local search (ADR 0009 compares them with
// CP-SAT). The random choices are seeded, so the same input always gives the same route.

/**
 * @param {object} problem
 * @param {ArrayLike<ArrayLike<number>>} problem.cost  walking seconds between locations:
 *   0 is the start, 1..n are the stops, n + 1 is the end (it may be the same place as the start)
 * @param {{dwell: number, value: number, mandatory?: boolean}[]} problem.stops  seconds, points
 * @param {number | null} [problem.budget]  seconds for the whole route; null visits every stop
 * @param {number} [problem.seed]
 * @param {number} [problem.effort]  scales the heuristics' iterations (1 = default)
 * @param {number} [problem.exact]  solve exactly up to this many stops (at most 16)
 * @returns {{order: number[], skipped: number[], feasible: boolean, walk: number, dwell: number}}
 *   `order` and `skipped` hold stop indexes (0-based). `feasible` is false when the must-sees (or
 *   just reaching the end) don't fit in the budget; `order` is then the shortest route through
 *   them.
 */
export function solve({ cost, stops, budget = null, seed = 1, effort = 1, exact = 12 }) {
  const n = stops.length;
  const ctx = {
    cost,
    stops,
    n,
    end: n + 1,
    rng: mulberry32(seed),
    effort,
    exact: Math.min(exact, MAX_EXACT),
  };
  const all = range(1, n + 1);
  if (budget === null) return result(ctx, shortestRoute(ctx, all), true);
  const mandatory = all.filter((k) => stops[k - 1].mandatory);
  const route = shortestRoute(ctx, mandatory);
  if (duration(ctx, route) > budget + EPSILON) return result(ctx, route, false);
  const best =
    n <= ctx.exact ? exactOrienteering(ctx, all, mandatory, budget) : orienteer(ctx, route, budget);
  return result(ctx, best, true);
}

const EPSILON = 1e-6;
const MAX_EXACT = 16; // 2^16 subsets x 16 endings x 8 bytes = 8 MB
// Budget routes: tuned on the real park against CP-SAT (scripts/benchmark_web_solver.py, ADR 0009).
const RUNS = 4; // independent searches: more robust than one search twice as long
const ACCEPT_WORSE = 0.05; // chance to continue from a worse route, to wander off local optima
const RESET_AFTER = 50; // iterations without a new best before going back to the best

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

function exactOrienteering(ctx, locations, mandatory, budget) {
  const { stops } = ctx;
  const n = locations.length;
  const walks = subsetWalks(ctx.cost, locations);
  const required = mandatory.reduce((mask, k) => mask | (1 << locations.indexOf(k)), 0);
  const value = new Float64Array(1 << n);
  const dwell = new Float64Array(1 << n);
  let best = null;
  for (let set = 0; set < 1 << n; set++) {
    if (set > 0) {
      const low = set & -set;
      const stop = stops[locations[31 - Math.clz32(low)] - 1];
      value[set] = value[set ^ low] + stop.value;
      dwell[set] = dwell[set ^ low] + stop.dwell;
    }
    if ((set & required) !== required) continue;
    const time = closeRoute(ctx, locations, walks, set).walk + dwell[set];
    if (time > budget + EPSILON) continue;
    if (
      best === null ||
      value[set] > best.value + EPSILON ||
      (value[set] > best.value - EPSILON && time < best.time - EPSILON)
    ) {
      best = { set, value: value[set], time };
    }
  }
  return exactRoute(ctx, locations, walks, best.set);
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

// ----------------------------------------------------------------------------- orienteering

/** Several independent searches from the same first route; the best one wins. */
function orienteer(ctx, start, budget) {
  const initial = improve(ctx, start.slice(), budget);
  if (initial.length === ctx.n + 2) return polish(ctx, initial, budget); // everything fits
  let best = initial;
  const iterations = Math.round(ctx.effort * (100 + 2.5 * ctx.n));
  for (let run = 0; run < RUNS; run++) {
    const found = searchFrom(ctx, initial, budget, iterations);
    if (better(ctx, found, best)) best = found;
  }
  return polish(ctx, best, budget);
}

/**
 * Iterated local search: kick the route, repair it, and carry on from there if it's worth at
 * least as much (or, now and then, anyway). Go back to the best route when stuck.
 */
function searchFrom(ctx, initial, budget, iterations) {
  const { rng } = ctx;
  let current = initial;
  let best = current;
  let stale = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const candidate = improve(ctx, kick(ctx, current, budget), budget);
    if (value(ctx, candidate) > value(ctx, current) - EPSILON || rng() < ACCEPT_WORSE) {
      current = candidate;
    }
    if (better(ctx, current, best)) {
      best = current;
      stale = 0;
    } else if (++stale % RESET_AFTER === 0) {
      current = best;
    }
  }
  return best;
}

/** Shorten the route, fill the time left, and swap stops while that's worth more. */
function improve(ctx, route, budget) {
  do {
    localSearch(ctx.cost, route);
    fill(ctx, route, budget);
  } while (swap(ctx, route, budget));
  return route;
}

/**
 * Shake the route up: drop a stretch of it, a few random stops, or force a new stop in (dropping
 * others until it fits). The result always fits in the budget.
 */
function kick(ctx, route, budget) {
  const { rng, stops } = ctx;
  const candidate = route.slice();
  const interior = candidate.length - 2;
  const optional = (k) => !stops[k - 1].mandatory;
  let forced = -1;
  const choice = rng();
  if (interior > 0 && choice < 0.4) {
    const length = 1 + Math.floor(rng() * Math.max(1, Math.ceil(interior / 3)));
    const from = 1 + Math.floor(rng() * interior);
    const to = Math.min(from + length, candidate.length - 1);
    const kept = candidate.slice(from, to).filter((k) => !optional(k));
    candidate.splice(from, to - from, ...kept);
  } else if (interior > 0 && choice < 0.7) {
    const positions = range(1, candidate.length - 1).filter((i) => optional(candidate[i]));
    const drops = 1 + Math.floor(rng() * Math.min(3, positions.length));
    for (const i of shuffle(rng, positions).slice(0, drops).sort((a, b) => b - a)) {
      candidate.splice(i, 1);
    }
  } else {
    const inRoute = new Set(candidate);
    const outside = range(1, ctx.n + 1).filter((k) => !inRoute.has(k));
    if (outside.length === 0) return candidate;
    forced = outside[Math.floor(rng() * outside.length)];
    candidate.splice(cheapestInsertion(ctx.cost, candidate, forced).position, 0, forced);
  }
  // Dropping a stop can lengthen the walk when costs break the triangle inequality.
  while (duration(ctx, candidate) > budget + EPSILON) {
    if (!dropWorst(ctx, candidate, forced)) return route.slice();
  }
  return candidate;
}

/** Remove the optional stop (other than `keep`) that gives the least per second, if any. */
function dropWorst(ctx, route, keep) {
  const { cost, stops } = ctx;
  let worst = null;
  for (let i = 1; i < route.length - 1; i++) {
    const k = route[i];
    if (stops[k - 1].mandatory || k === keep) continue;
    const saving =
      cost[route[i - 1]][k] + cost[k][route[i + 1]] - cost[route[i - 1]][route[i + 1]];
    const ratio = stops[k - 1].value / Math.max(saving + stops[k - 1].dwell, EPSILON);
    if (worst === null || ratio < worst.ratio) worst = { i, ratio };
  }
  if (worst !== null) route.splice(worst.i, 1);
  return worst !== null;
}

/** Greedily add the stops with the most value per added second while they fit. */
function fill(ctx, route, budget) {
  const { cost, stops, n } = ctx;
  const inRoute = new Set(route);
  let total = duration(ctx, route);
  for (;;) {
    let pick = null;
    for (let k = 1; k <= n; k++) {
      if (inRoute.has(k)) continue;
      const { delta, position } = cheapestInsertion(cost, route, k);
      const added = delta + stops[k - 1].dwell;
      if (total + added > budget + EPSILON) continue;
      const ratio = stops[k - 1].value / Math.max(added, EPSILON);
      if (pick === null || ratio > pick.ratio) pick = { k, position, ratio };
    }
    if (pick === null) return route;
    route.splice(pick.position, 0, pick.k);
    inRoute.add(pick.k);
    localSearch(cost, route);
    total = duration(ctx, route);
  }
}

/** Replace one optional stop with one left out, if that's worth more, or as much in less time. */
function swap(ctx, route, budget) {
  const { cost, stops, n } = ctx;
  const total = duration(ctx, route);
  const inRoute = new Set(route);
  for (let i = 1; i < route.length - 1; i++) {
    const out = route[i];
    if (stops[out - 1].mandatory) continue;
    const without = [...route.slice(0, i), ...route.slice(i + 1)];
    const saving = total - duration(ctx, without);
    for (let k = 1; k <= n; k++) {
      if (inRoute.has(k)) continue;
      const gain = stops[k - 1].value - stops[out - 1].value;
      if (gain < -EPSILON) continue;
      const { delta, position } = cheapestInsertion(cost, without, k);
      const time = total - saving + delta + stops[k - 1].dwell;
      if (time > budget + EPSILON) continue;
      if (gain > EPSILON || time < total - EPSILON) {
        without.splice(position, 0, k);
        route.splice(0, route.length, ...without);
        return true;
      }
    }
  }
  return false;
}

/** Re-solve the order of the chosen stops, and use any time that frees up. */
function polish(ctx, route, budget) {
  for (;;) {
    const reordered = shortestRoute(ctx, route.slice(1, -1));
    if (walking(ctx.cost, reordered) > walking(ctx.cost, route) - EPSILON) return route;
    const length = reordered.length;
    route = improve(ctx, reordered, budget);
    if (route.length === length) return route;
  }
}

function better(ctx, a, b) {
  const [va, vb] = [value(ctx, a), value(ctx, b)];
  return va > vb + EPSILON || (va > vb - EPSILON && duration(ctx, a) < duration(ctx, b) - EPSILON);
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

function dwelling({ stops }, route) {
  let total = 0;
  for (let i = 1; i < route.length - 1; i++) total += stops[route[i] - 1].dwell;
  return total;
}

function duration(ctx, route) {
  return walking(ctx.cost, route) + dwelling(ctx, route);
}

function value({ stops }, route) {
  let total = 0;
  for (let i = 1; i < route.length - 1; i++) total += stops[route[i] - 1].value;
  return total;
}

function result(ctx, route, feasible) {
  const order = route.slice(1, -1).map((k) => k - 1);
  const visited = new Set(order);
  return {
    order,
    skipped: range(0, ctx.n).filter((i) => !visited.has(i)),
    feasible,
    walk: walking(ctx.cost, route),
    dwell: dwelling(ctx, route),
  };
}

function range(from, to) {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

function shuffle(rng, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
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

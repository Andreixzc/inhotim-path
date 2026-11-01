import assert from "node:assert/strict";
import { test } from "node:test";

import { mulberry32, solve } from "../../web/js/solver.js";

// Each check runs twice: with the exact solver (the default for few stops) and with the heuristics
// forced on (`exact: 0`), which is what real routes with dozens of stops use.
const MODES = [
  ["exact", {}],
  ["heuristic", { exact: 0 }],
];

/** Random park-like instance: locations on a 1 km square, walking at 1 m/s. */
function instance(seed, n, { closed = true, asymmetric = false } = {}) {
  const rng = mulberry32(seed);
  const points = Array.from({ length: n + 2 }, () => [rng() * 1000, rng() * 1000]);
  if (closed) points[n + 1] = points[0]; // the end is the start: a loop
  const cost = points.map((a, i) =>
    points.map((b, j) => Math.hypot(a[0] - b[0], a[1] - b[1]) * (asymmetric && i < j ? 1.3 : 1)),
  );
  const stops = Array.from({ length: n }, () => {
    const minutes = [3, 5, 8, 10, 20][Math.floor(rng() * 5)];
    return { dwell: minutes * 60, value: minutes };
  });
  return { cost, stops };
}

function walk(cost, order) {
  const route = [0, ...order.map((i) => i + 1), cost.length - 1];
  return route.slice(1).reduce((total, k, i) => total + cost[route[i]][k], 0);
}

function* permutations(items) {
  if (items.length <= 1) yield items;
  else
    for (let i = 0; i < items.length; i++)
      for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)]))
        yield [items[i], ...rest];
}

/** The best {value, time} over every subset and order (every stop when there's no budget). */
function bruteForce({ cost, stops }, budget = null) {
  const n = stops.length;
  let best = { value: -1, time: Infinity };
  for (let mask = 0; mask < 1 << n; mask++) {
    const chosen = [...Array(n).keys()].filter((i) => mask & (1 << i));
    if (budget === null && chosen.length < n) continue;
    if (stops.some((s, i) => s.mandatory && !chosen.includes(i))) continue;
    const value = chosen.reduce((t, i) => t + stops[i].value, 0);
    const dwell = chosen.reduce((t, i) => t + stops[i].dwell, 0);
    for (const order of permutations(chosen)) {
      const time = walk(cost, order) + dwell;
      if (budget !== null && time > budget + 1e-6) continue;
      if (value > best.value || (value === best.value && time < best.time - 1e-6)) {
        best = { value, time };
      }
    }
  }
  return best;
}

function measure({ cost, stops }, solution) {
  const value = solution.order.reduce((t, i) => t + stops[i].value, 0);
  const dwell = solution.order.reduce((t, i) => t + stops[i].dwell, 0);
  return { value, time: walk(cost, solution.order) + dwell };
}

function assertSame(got, best, label) {
  assert.equal(got.value, best.value, label);
  assert.ok(Math.abs(got.time - best.time) < 1e-6, `${label}: ${got.time} vs ${best.time}`);
}

for (const [mode, options] of MODES) {
  test(`${mode}: visiting everything finds the shortest loop (brute force)`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const problem = instance(seed, 7);
      const solution = solve({ ...problem, ...options });
      assert.deepEqual([...solution.order].sort(), [0, 1, 2, 3, 4, 5, 6]);
      assertSame(measure(problem, solution), bruteForce(problem), `seed ${seed}`);
    }
  });

  test(`${mode}: open routes and direction-dependent costs (brute force)`, () => {
    for (let seed = 1; seed <= 15; seed++) {
      for (const shape of [{ closed: false }, { asymmetric: true }]) {
        const problem = instance(seed, 7, shape);
        const solution = solve({ ...problem, ...options });
        assertSame(measure(problem, solution), bruteForce(problem), `seed ${seed}`);
      }
    }
  });

  test(`${mode}: a budget gets the most minutes at stops, then the least time`, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const problem = instance(seed, 7);
      for (const budget of [900, 1800, 3000]) {
        const solution = solve({ ...problem, budget, ...options });
        const label = `seed ${seed}, budget ${budget}`;
        assert.ok(solution.feasible, label);
        assertSame(measure(problem, solution), bruteForce(problem, budget), label);
      }
    }
  });

  test(`${mode}: must-sees are always in, and say so when they can't fit`, () => {
    for (let seed = 1; seed <= 10; seed++) {
      const problem = instance(seed, 7, { closed: seed % 2 === 0 });
      problem.stops[2].mandatory = true;
      problem.stops[5].mandatory = true;
      const mustSees = Math.min(walk(problem.cost, [2, 5]), walk(problem.cost, [5, 2]));
      const budget = mustSees + problem.stops[2].dwell + problem.stops[5].dwell + 900;
      const fits = solve({ ...problem, budget, ...options });
      assert.ok(fits.feasible);
      assert.ok(fits.order.includes(2) && fits.order.includes(5));
      assertSame(measure(problem, fits), bruteForce(problem, budget), `seed ${seed}`);

      const tooShort = solve({ ...problem, budget: 60, ...options });
      assert.equal(tooShort.feasible, false);
      assert.deepEqual([...tooShort.order].sort(), [2, 5]);
    }
  });
}

test("the heuristics come close to the exact answer with 12 stops", () => {
  let gaps = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const problem = instance(seed, 12);
    const exact = measure(problem, solve(problem));
    const heuristic = measure(problem, solve({ ...problem, exact: 0 }));
    assert.ok(heuristic.time >= exact.time - 1e-6, "the exact answer can't be beaten");
    gaps += heuristic.time / exact.time - 1;
    for (const budget of [1800, 3600]) {
      const best = measure(problem, solve({ ...problem, budget }));
      const got = measure(problem, solve({ ...problem, budget, exact: 0 }));
      assert.ok(got.value <= best.value && got.value >= best.value * 0.9, `seed ${seed}`);
    }
  }
  assert.ok(gaps / 10 < 0.01, `average gap ${((gaps / 10) * 100).toFixed(2)}%`);
});

test("large routes stay within the budget and visit each stop once", () => {
  for (let seed = 1; seed <= 3; seed++) {
    const problem = instance(seed, 60);
    for (const budget of [3600, 7200, null]) {
      const solution = solve({ ...problem, budget });
      const label = `seed ${seed}, budget ${budget}`;
      assert.equal(new Set(solution.order).size, solution.order.length, label);
      assert.deepEqual(
        [...solution.order, ...solution.skipped].sort((a, b) => a - b),
        [...Array(60).keys()],
        label,
      );
      const { time } = measure(problem, solution);
      if (budget !== null) assert.ok(time <= budget + 1e-6, label);
      assert.ok(Math.abs(solution.walk + solution.dwell - time) < 1e-6, label);
    }
  }
});

test("nothing to visit, or no time for anything", () => {
  const empty = solve({ cost: [[0, 0], [0, 0]], stops: [] });
  assert.deepEqual(empty, { order: [], skipped: [], feasible: true, walk: 0, dwell: 0 });
  for (const options of [{}, { exact: 0 }]) {
    const problem = instance(3, 5);
    const none = solve({ ...problem, budget: 10, ...options });
    assert.equal(none.feasible, true);
    assert.deepEqual(none.order, []);
    assert.deepEqual(none.skipped, [0, 1, 2, 3, 4]);
  }
});

test("the same input always gives the same route", () => {
  const problem = instance(11, 30);
  const first = solve({ ...problem, budget: 5400 });
  assert.deepEqual(solve({ ...problem, budget: 5400 }), first);
  assert.notDeepEqual(solve({ ...problem, budget: 5400, seed: 2 }).order, []);
});

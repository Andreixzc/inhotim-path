import assert from "node:assert/strict";
import { test } from "node:test";

import { mulberry32, solve } from "../../web/js/solver.js";

// Each check runs twice: with the exact solver (the default for few stops) and with the heuristics
// forced on (`exact: 0`), which is what real routes with dozens of stops use.
const MODES = [
  ["exact", {}],
  ["heuristic", { exact: 0 }],
];

/** Walking costs for a random park: the start, `n` stops and the end on a 1 km square, at 1 m/s. */
function instance(seed, n, { closed = true, asymmetric = false } = {}) {
  const rng = mulberry32(seed);
  const points = Array.from({ length: n + 2 }, () => [rng() * 1000, rng() * 1000]);
  if (closed) points[n + 1] = points[0]; // the end is the start: a loop
  return points.map((a, i) =>
    points.map((b, j) => Math.hypot(a[0] - b[0], a[1] - b[1]) * (asymmetric && i < j ? 1.3 : 1)),
  );
}

const stops = (n) => [...Array(n).keys()];
const sorted = (items) => [...items].sort((a, b) => a - b);

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

/** The shortest walk through every stop, by trying every order. */
function bruteForce(cost) {
  let best = Infinity;
  for (const order of permutations(stops(cost.length - 2))) {
    best = Math.min(best, walk(cost, order));
  }
  return best;
}

function assertShortest(cost, solution, label) {
  assert.deepEqual(sorted(solution.order), stops(cost.length - 2), label);
  const got = walk(cost, solution.order);
  const best = bruteForce(cost);
  assert.ok(Math.abs(got - best) < 1e-6, `${label}: ${got} vs ${best}`);
  assert.ok(Math.abs(solution.walk - got) < 1e-6, `${label}: reported walk`);
}

for (const [mode, options] of MODES) {
  test(`${mode}: visiting everything finds the shortest loop (brute force)`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const cost = instance(seed, 7);
      assertShortest(cost, solve({ cost, ...options }), `seed ${seed}`);
    }
  });

  test(`${mode}: open routes and direction-dependent costs (brute force)`, () => {
    for (let seed = 1; seed <= 15; seed++) {
      for (const shape of [{ closed: false }, { asymmetric: true }]) {
        const cost = instance(seed, 7, shape);
        assertShortest(cost, solve({ cost, ...options }), `seed ${seed} ${JSON.stringify(shape)}`);
      }
    }
  });
}

test("the heuristics come close to the exact answer with 12 stops", () => {
  let gaps = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const cost = instance(seed, 12);
    const exact = solve({ cost }).walk;
    const heuristic = solve({ cost, exact: 0 }).walk;
    assert.ok(heuristic >= exact - 1e-6, "the exact answer can't be beaten");
    gaps += heuristic / exact - 1;
  }
  assert.ok(gaps / 10 < 0.01, `average gap ${((gaps / 10) * 100).toFixed(2)}%`);
});

test("large routes visit each stop once", () => {
  for (let seed = 1; seed <= 3; seed++) {
    const cost = instance(seed, 60);
    const solution = solve({ cost });
    assert.deepEqual(sorted(solution.order), stops(60), `seed ${seed}`);
    assert.ok(Math.abs(solution.walk - walk(cost, solution.order)) < 1e-6, `seed ${seed}`);
  }
});

test("nothing to visit, or a single stop", () => {
  assert.deepEqual(solve({ cost: [[0, 0], [0, 0]] }), { order: [], walk: 0 });
  const one = [
    [0, 5, 0],
    [5, 0, 5],
    [0, 5, 0],
  ];
  for (const options of [{}, { exact: 0 }]) {
    assert.deepEqual(solve({ cost: one, ...options }), { order: [0], walk: 10 });
  }
});

test("the same input always gives the same route", () => {
  const cost = instance(11, 30);
  assert.deepEqual(solve({ cost }), solve({ cost }));
  assert.deepEqual(sorted(solve({ cost, seed: 2 }).order), stops(30));
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { WalkNetwork } from "../../web/js/network.js";
import {
  DURATION,
  FINISHED,
  TIMING,
  flicker,
  frame,
  paths,
  reached,
  routeKey,
  routeLine,
  slice,
  wave,
} from "../../web/js/reveal.js";

// A triangle near Inhotim: A-B 100 m, B-C 100 m, and A-C 150 m straight across.
const [A, B, C] = [
  [-44.22, -20.12],
  [-44.219, -20.12],
  [-44.219, -20.119],
];
const park = {
  nodes: [A, B, C],
  edges: [
    [0, 1, 100, []],
    [1, 2, 100, []],
    [0, 2, 150, []],
  ],
};

function close(actual, expected) {
  assert.equal(actual.length, expected.length, `${JSON.stringify(actual)}`);
  actual.forEach((point, i) => {
    assert.ok(Math.abs(point[0] - expected[i][0]) < 1e-9, `${point} vs ${expected[i]}`);
    assert.ok(Math.abs(point[1] - expected[i][1]) < 1e-9, `${point} vs ${expected[i]}`);
  });
}

const between = (a, b, t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];

test("a slice of a polyline, by meters along it", () => {
  const points = [
    [0, 0],
    [6, 0],
    [10, 0],
  ];
  const along = [0, 6, 10];
  close(slice(points, along, 0, 10), points);
  close(slice(points, along, 3, 8), [
    [3, 0],
    [6, 0],
    [8, 0],
  ]);
  close(slice(points, along, 7, 9), [
    [7, 0],
    [9, 0],
  ]);
});

test("paths keep their real length, whatever the shape's own scale", () => {
  const [ab] = paths(park);
  assert.deepEqual(ab.points, [A, B]);
  assert.deepEqual(ab.along, [0, 100]);
});

test("the wave reaches every path from the start, meeting halfway on a loop", () => {
  const network = new WalkNetwork(park);
  const all = paths(park);
  const { reach, depth } = wave(all, network.shortestPaths([[0, 0]]).dist);
  // From A: B is 100 m away and C 150 m (straight across). On B-C, the fronts from B and from C
  // meet 75 m from B, 175 m from the start: the farthest point the wave reaches.
  assert.deepEqual(reach, [
    { from: 0, to: 100, meet: 100 },
    { from: 100, to: 150, meet: 75 },
    { from: 0, to: 150, meet: 150 },
  ]);
  assert.equal(depth, 175);

  // 125 m out: all of A-B, the first 25 m of B-C, and 125 m of A-C.
  const at125 = all.map((path, i) => reached(path, reach[i], 125));
  close(at125[0][0], [A, B]);
  assert.equal(at125[1].length, 1);
  close(at125[1][0], [B, between(B, C, 0.25)]);
  close(at125[2][0], [A, between(A, C, 125 / 150)]);

  // Its front: only the last 30 m.
  const front = all.map((path, i) => reached(path, reach[i], 125, 30));
  close(front[0][0], [between(A, B, 0.95), B]);
  close(front[1][0], [B, between(B, C, 0.25)]);
  close(front[2][0], [between(A, C, 95 / 150), between(A, C, 125 / 150)]);

  // At the end, B-C is lit from both ends, up to where the fronts met.
  const end = reached(all[1], reach[1], depth);
  assert.equal(end.length, 2);
  close(end[0], [B, between(B, C, 0.75)]);
  close(end[1], [between(B, C, 0.75), C]);

  // Before the start, nothing.
  assert.deepEqual(reached(all[0], reach[0], 0), []);
  assert.deepEqual(reached(all[0], null, 100), []);
});

test("the route as one line, with where each visit is on it", () => {
  const line = routeLine([[A, B], [B, C], [C, A]]);
  assert.deepEqual(line.points, [A, B, C, A]);
  assert.equal(line.visits.length, 4);
  assert.equal(line.visits[0], 0);
  assert.ok(line.visits[1] > 100 && line.visits[1] < 110); // ~105 m east-west at this latitude
  assert.ok(line.visits[2] > line.visits[1]);
  assert.equal(line.visits[3], line.length);

  // Two stops at the same spot (a leg with one point) are reached at the same moment.
  const nextDoor = routeLine([[A, B], [B], [B, A]]);
  assert.deepEqual(nextDoor.points, [A, B, A]);
  assert.equal(nextDoor.visits[1], nextDoor.visits[2]);

  assert.deepEqual(routeLine([]), { points: [], along: [], length: 0, visits: [0] });
});

test("the timeline: search first, then the route, then done", () => {
  const first = frame(0);
  assert.equal(first.searching, true);
  assert.equal(first.done, false);
  assert.equal(first.drawn, 0);
  assert.equal(first.front, 0);
  assert.equal(first.old, 1);
  assert.equal(first.glow, 1);

  assert.equal(frame(TIMING.wave).front, 1);
  assert.equal(frame(TIMING.wave).flash, 1);
  assert.equal(frame(TIMING.traceFrom).searching, false);

  const last = frame(DURATION);
  assert.equal(last.done, true);
  assert.equal(last.drawn, 1);
  assert.equal(last.glow, 0);
  assert.equal(last.old, 0);
  assert.deepEqual({ ...last, flash: 0 }, { ...FINISHED });

  let drawn = 0;
  for (let ms = 0; ms <= DURATION; ms += 10) {
    assert.ok(frame(ms).drawn >= drawn);
    drawn = frame(ms).drawn;
  }
});

test("the front's blink is the same every time, and never goes dark", () => {
  for (let i = 0; i < 50; i++) {
    for (const ms of [0, 44, 45, 300, 999]) {
      const value = flicker(i, ms);
      assert.ok(value >= 0.35 && value <= 1, `${value}`);
      assert.equal(flicker(i, ms), value);
    }
  }
  assert.notEqual(flicker(1, 0), flicker(1, 45));
});

test("routes with the same stops, in the same order, from the same start, match", () => {
  const visits = (...ids) => ids.map((id) => ({ poi: { id }, lnglat: [0, 0] }));
  assert.equal(routeKey({ visits: visits(1, 5, 7, 1) }), routeKey({ visits: visits(1, 5, 7, 1) }));
  assert.notEqual(routeKey({ visits: visits(1, 5, 7, 1) }), routeKey({ visits: visits(1, 7, 5, 1) }));
  const here = { poi: null, lnglat: [-44.2, -20.1] };
  assert.equal(routeKey({ visits: [here, ...visits(5, 1)] }), "-44.2,-20.1 5 1");
});

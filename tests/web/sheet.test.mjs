import assert from "node:assert/strict";
import { test } from "node:test";

import { FLICK, releaseSpeed, settlesCollapsed } from "../../web/js/sheet.js";

const max = 260; // a sheet that goes 260 px down when lowered

test("a flick goes the way the finger was moving, wherever the sheet is", () => {
  assert.equal(settlesCollapsed({ shift: 10, max, velocity: FLICK }), true);
  assert.equal(settlesCollapsed({ shift: 250, max, velocity: -FLICK }), false);
  assert.equal(settlesCollapsed({ shift: 130, max, velocity: 2 }), true);
});

test("a slow release settles on the nearer end", () => {
  assert.equal(settlesCollapsed({ shift: 131, max, velocity: 0.1 }), true);
  assert.equal(settlesCollapsed({ shift: 129, max, velocity: -0.1 }), false);
  assert.equal(settlesCollapsed({ shift: max, max, velocity: 0 }), true);
  assert.equal(settlesCollapsed({ shift: 0, max, velocity: 0 }), false);
});

test("a sheet with nothing to hide stays up", () => {
  assert.equal(settlesCollapsed({ shift: 0, max: 0, velocity: 0 }), false);
});

test("a quick flick is measured from the press", () => {
  // 60 px up in 80 ms, let go 8 ms later: 0.68 px per ms.
  const track = [[0, 600], [8, 590], [40, 570], [80, 540]];
  assert.equal(releaseSpeed(track, 88, 540).toFixed(2), "-0.68");
});

test("a long drag is measured over its last 100 ms", () => {
  // Down at 1 px per ms for 300 ms, then 0.3 px per ms.
  const track = [[0, 100], [100, 200], [200, 300], [300, 400], [350, 415], [400, 430]];
  assert.equal(releaseSpeed(track, 400, 430).toFixed(2), "0.30");
});

test("a finger that rested before letting go has no speed", () => {
  const track = [[0, 100], [100, 300], [200, 400]];
  assert.equal(releaseSpeed(track, 450, 400), 0);
});

test("the wobble of a lifting fingertip is no flick", () => {
  // At rest for 300 ms, then 4 px in the last 16 ms.
  const track = [[0, 100], [100, 300], [400, 302], [408, 304]];
  const speed = releaseSpeed(track, 416, 304);
  assert.ok(Math.abs(speed) < FLICK / 4, speed);
});

test("a press let go at once has no speed", () => {
  assert.equal(releaseSpeed([[0, 100]], 0, 100), 0);
});

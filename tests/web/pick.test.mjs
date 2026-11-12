import assert from "node:assert/strict";
import { test } from "node:test";

import { REACH, nearest, reachFor } from "../../web/js/pick.js";

const dot = (x, y, name) => ({ x, y, r: 4, name });
const stop = (x, y, name) => ({ x, y, r: 13, name });

test("a click near a small dot opens it", () => {
  const targets = [dot(100, 100, "dot")];
  assert.equal(nearest({ x: 100, y: 100 }, targets, REACH.mouse)?.name, "dot");
  assert.equal(nearest({ x: 111, y: 100 }, targets, REACH.mouse)?.name, "dot");
  assert.equal(nearest({ x: 113, y: 100 }, targets, REACH.mouse), null);
  // A finger reaches further: the dot is a 48 px target.
  assert.equal(nearest({ x: 124, y: 100 }, targets, REACH.touch)?.name, "dot");
  assert.equal(nearest({ x: 125, y: 100 }, targets, REACH.touch), null);
});

test("the nearest edge wins, so a big marker isn't lost to a dot beside it", () => {
  const targets = [stop(100, 100, "stop"), dot(130, 100, "dot")];
  // 2 px outside the marker, 11 px from the dot's edge.
  assert.equal(nearest({ x: 115, y: 100 }, targets, REACH.touch)?.name, "stop");
  // 5 px from the dot's edge, 8 px outside the marker.
  assert.equal(nearest({ x: 121, y: 100 }, targets, REACH.touch)?.name, "dot");
});

test("under the click, the nearest center wins", () => {
  const targets = [dot(100, 100, "left"), dot(104, 100, "right")];
  assert.equal(nearest({ x: 101, y: 100 }, targets, REACH.mouse)?.name, "left");
  assert.equal(nearest({ x: 103, y: 100 }, targets, REACH.mouse)?.name, "right");
});

test("nothing in reach, or nothing at all", () => {
  assert.equal(nearest({ x: 0, y: 0 }, [stop(100, 100, "far")], REACH.touch), null);
  assert.equal(nearest({ x: 0, y: 0 }, [], REACH.touch), null);
});

test("a finger reaches further than a mouse", () => {
  assert.equal(reachFor({ pointerType: "touch" }, false), REACH.touch);
  assert.equal(reachFor({ pointerType: "pen" }, false), REACH.touch);
  assert.equal(reachFor({ pointerType: "mouse" }, true), REACH.mouse);
  // Browsers whose clicks don't say: the device's main pointer decides.
  assert.equal(reachFor({}, true), REACH.touch);
  assert.equal(reachFor(undefined, false), REACH.mouse);
});

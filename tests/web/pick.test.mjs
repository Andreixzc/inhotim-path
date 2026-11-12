import assert from "node:assert/strict";
import { test } from "node:test";

import {
  POPUP_ROOM,
  REACH,
  focusPopup,
  nearest,
  placePopup,
  reachFor,
} from "../../web/js/pick.js";

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

// A 360 px phone with the sheet lowered: 525 px of map above it, and buttons at the top right.
const PHONE = { left: 0, top: 0, right: 360, bottom: 525, corner: { left: 320, bottom: 107 } };
const POPUP = { width: 290, height: 150 };
const place = (x, y, view = PHONE) => placePopup({ x, y }, POPUP, view, 14);

test("a popup goes above its place, and the map moves it off the sides", () => {
  assert.deepEqual(place(180, 400), { anchor: "bottom", pan: [0, 0] });
  // 145 px each side of the place: past the right edge, then the left one.
  assert.deepEqual(place(240, 400), { anchor: "bottom", pan: [240 + 145 - (360 - POPUP_ROOM), 0] });
  assert.deepEqual(place(60, 400), { anchor: "bottom", pan: [60 - 145 - POPUP_ROOM, 0] });
});

test("near the top, a popup goes below its place", () => {
  assert.deepEqual(place(160, 140), { anchor: "top", pan: [0, 0] });
  // Under the map's buttons at the top right, it can't go above a place even lower down.
  assert.deepEqual(place(160, 250), { anchor: "bottom", pan: [0, 0] });
  const right = 300 + 145 - (360 - POPUP_ROOM);
  assert.deepEqual(place(300, 250), { anchor: "top", pan: [right, 0] });
});

test("with little room, it goes where there's more, and the map moves to show all of it", () => {
  // The sheet raised: 280 px of map, 114 px each side of a place in the middle.
  const raised = { ...PHONE, bottom: 280 };
  assert.deepEqual(place(160, 140, raised), { anchor: "bottom", pan: [0, 140 - 14 - 150 - 12] });
  assert.deepEqual(place(160, 120, raised), { anchor: "top", pan: [0, 120 + 14 + 150 - 268] });
  // A place under the sheet: the map moves up.
  assert.deepEqual(place(180, 600), { anchor: "bottom", pan: [0, 600 - 14 - 525 + 12] });
});

test("in even less room than a popup takes, its name and close button show", () => {
  const tiny = { ...PHONE, bottom: 150 };
  assert.deepEqual(place(160, 100, tiny), { anchor: "bottom", pan: [0, 100 - 14 - 150 - 12] });
  assert.deepEqual(place(160, 30, tiny), { anchor: "top", pan: [0, 30 + 14 - 12] });
});

test("moving to a place, its popup shows whole, clear of the map's buttons", () => {
  // Left of the middle, so the popup fits beside the buttons: above the place.
  assert.deepEqual(focusPopup(POPUP, PHONE, 14), {
    at: { x: 320 - POPUP_ROOM - 145, y: 525 / 2 },
    anchor: "bottom",
  });
  // The sheet raised: low enough for the popup above the place.
  const raised = { ...PHONE, bottom: 235 };
  assert.deepEqual(focusPopup(POPUP, raised, 14), {
    at: { x: 163, y: POPUP_ROOM + 150 + 14 },
    anchor: "bottom",
  });
  // On a wider phone, in the middle.
  const wide = { ...PHONE, right: 430, corner: { left: 390, bottom: 107 } };
  assert.equal(focusPopup(POPUP, wide, 14).at.x, 215);
});

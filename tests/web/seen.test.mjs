import assert from "node:assert/strict";
import { test } from "node:test";

import * as seen from "../../web/js/seen.js";

const { LINGER, Linger, metersBetween } = seen;

/** A time on 12 November 2026 (local), or on another day. */
const at = (hour, minute = 0, day = 12) => new Date(2026, 10, day, hour, minute).getTime();

/** A point `north` and `east` meters from the middle of Inhotim. */
const BASE = [-44.22, -20.125];
const point = (north, east = 0) => [
  BASE[0] + east / (111195 * Math.cos((BASE[1] * Math.PI) / 180)),
  BASE[1] + north / 111195,
];

test("marks keep their order, and marking again makes a stop the latest", () => {
  let s = seen.empty();
  s = seen.mark(s, 10, at(9));
  s = seen.mark(s, 20, at(10));
  s = seen.mark(s, 10, at(11));
  assert.deepEqual(seen.ids(s), [20, 10]);
  assert.ok(seen.has(s, 20));
  s = seen.unmark(s, 20);
  assert.deepEqual(seen.ids(s), [10]);
  assert.ok(!seen.has(s, 20));
});

test("the visit goes on from the stop seen last today", () => {
  let s = seen.mark(seen.empty(), 10, at(9));
  s = seen.mark(s, 20, at(10));
  assert.equal(seen.continueFrom(s, at(15)), 20);
  // Unmarking it goes back to the one before.
  assert.equal(seen.continueFrom(seen.unmark(s, 20), at(15)), 10);
  // The next day, a two-day visit starts at the Portaria again.
  assert.equal(seen.continueFrom(s, at(9, 0, 13)), null);
  assert.equal(seen.continueFrom(seen.empty(), at(15)), null);
});

test("choosing the Portaria starts there until the next stop is seen", () => {
  let s = seen.mark(seen.empty(), 10, at(9));
  s = seen.restart(s, at(10));
  assert.equal(seen.continueFrom(s, at(11)), null);
  s = seen.mark(s, 30, at(12));
  assert.equal(seen.continueFrom(s, at(13)), 30);
});

test("saved marks are checked: junk and stops the park no longer has are dropped", () => {
  const known = (id) => id !== 99;
  const saved = {
    marks: [[10, at(9)], [99, at(9)], ["x", at(9)], [20], [10, at(10)], "junk", [30, at(1)]],
    restart: at(8),
  };
  assert.deepEqual(seen.parse(saved, known), { marks: [[10, at(9)], [30, at(1)]], restart: at(8) });
  assert.deepEqual(seen.parse(null, known), seen.empty());
  assert.deepEqual(seen.parse({ marks: "nope" }, known), seen.empty());
});

test("meters between two points", () => {
  assert.ok(Math.abs(metersBetween(point(0), point(100)) - 100) < 0.5);
  assert.ok(Math.abs(metersBetween(point(0), point(0, 100)) - 100) < 0.5);
  assert.equal(metersBetween(BASE, BASE), 0);
});

const stops = [
  { id: 1, lnglat: point(0) },
  { id: 2, lnglat: point(200) },
];
const fix = (north, minutes, accuracy = 15) => ({
  lnglat: point(north),
  accuracy,
  time: at(10, minutes),
});

test("a stop is suggested after a couple of minutes near it, once", () => {
  const linger = new Linger();
  assert.equal(linger.update(fix(150, 0), stops), null); // walking
  assert.equal(linger.update(fix(20, 1), stops), null); // arrives at stop 1
  assert.equal(linger.update(fix(25, 2), stops), null);
  assert.equal(linger.update(fix(10, 3), stops), 1);
  assert.equal(linger.update(fix(10, 4), stops), null); // only once
});

test("GPS drift near the stop doesn't start the wait over, walking off does", () => {
  const linger = new Linger();
  linger.update(fix(30, 0), stops);
  assert.equal(linger.update(fix(LINGER.away - 5, 1), stops), null); // drifts, still near
  assert.equal(linger.update(fix(0, 2), stops), 1);

  const walker = new Linger();
  walker.update(fix(30, 0), stops);
  walker.update(fix(LINGER.away + 30, 1), stops); // walks off
  assert.equal(walker.update(fix(0, 2), stops), null); // back: the wait starts over
  assert.equal(walker.update(fix(0, 4), stops), 1);
});

test("vague fixes don't count, and a stop seen meanwhile isn't suggested", () => {
  const linger = new Linger();
  linger.update(fix(0, 0), stops);
  assert.equal(linger.update(fix(0, 3, 500), stops), null); // too vague
  assert.equal(linger.update(fix(0, 3, Number.NaN), stops), null);
  assert.equal(linger.update(fix(0, 3), [stops[1]]), null); // stop 1 was marked seen
  assert.equal(linger.update(fix(200, 4), [stops[1]]), null); // at stop 2: the wait starts
  assert.equal(linger.update(fix(200, 6), [stops[1]]), 2);
});

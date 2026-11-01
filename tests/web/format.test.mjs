import assert from "node:assert/strict";
import { test } from "node:test";

import { clock, distance, duration, nowRounded, parseClock } from "../../web/js/format.js";
import { defaults, fromHash, toHash } from "../../web/js/state.js";

test("durations, like the command line", () => {
  assert.equal(duration(45 * 60), "45 min");
  assert.equal(duration(65 * 60), "1h05");
  assert.equal(duration(6 * 3600 + 29), "6h00");
  assert.equal(duration(0), "0 min");
});

test("times of day", () => {
  assert.equal(parseClock("09:30"), 570);
  assert.equal(parseClock("9:05"), 545);
  assert.equal(parseClock("24:00"), null);
  assert.equal(parseClock("noon"), null);
  assert.equal(clock(570, 3 * 3600 + 300), "12:35");
  assert.equal(clock(23 * 60, 2 * 3600), "01:00 +1");
  assert.equal(nowRounded(new Date(2026, 10, 1, 14, 2)), "14:05");
  assert.equal(nowRounded(new Date(2026, 10, 1, 23, 58)), "23:55");
});

test("distances", () => {
  assert.equal(distance(347), "350 m");
  assert.equal(distance(1234, "en"), "1.2 km");
  assert.equal(distance(1234, "pt-BR"), "1,2 km");
  assert.equal(distance(451_049, "en"), "451 km");
  assert.equal(distance(451_049, "pt-BR"), "451 km");
});

const parkDefaults = { kinds: ["gallery", "outdoor_work", "garden"] };

test("settings survive a round trip through a link", () => {
  const state = {
    ...defaults(parkDefaults),
    budgetMin: 240,
    startTime: "10:15",
    must: [3386, 3425],
    exclude: [12],
    pace: "relaxed",
    dwellMin: { gallery: 30 },
  };
  const hash = toHash(state);
  assert.equal(
    hash,
    "b=240&t=1015&k=gallery,outdoor_work,garden&m=3386,3425&x=12&p=relaxed&d=gallery:30",
  );
  assert.deepEqual(fromHash(`#${hash}`, defaults(parkDefaults)), state);
  const all = { ...defaults(parkDefaults), budgetMin: null };
  assert.equal(fromHash(toHash(all), defaults(parkDefaults)).budgetMin, null);
});

test("junk in a link is ignored", () => {
  const base = defaults(parkDefaults);
  const state = fromHash("#b=-5&t=2599&k=<script>&m=1,x,2.5,7&p=fast&d=gallery:-1,garden:15", base);
  assert.equal(state.budgetMin, base.budgetMin);
  assert.equal(state.startTime, base.startTime);
  assert.deepEqual(state.kinds, []);
  assert.deepEqual(state.must, [1, 7]);
  assert.equal(state.pace, "normal");
  assert.deepEqual(state.dwellMin, { garden: 15 });
  assert.equal(state.from, "reception", "a link never starts from someone's position");
});

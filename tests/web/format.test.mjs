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

test("settings survive a round trip through a link", () => {
  const state = {
    ...defaults(),
    budgetMin: 240,
    startTime: "10:15",
    see: "galleries",
    must: [3386, 3425],
    exclude: [12],
  };
  const hash = toHash(state);
  assert.equal(hash, "b=240&t=1015&s=galleries&m=3386,3425&x=12");
  assert.deepEqual(fromHash(`#${hash}`, defaults()), state);
  const all = { ...defaults(), budgetMin: null };
  assert.equal(fromHash(toHash(all), defaults()).budgetMin, null);
});

test("junk in a link is ignored", () => {
  const base = defaults();
  const state = fromHash("#b=-5&t=2599&s=constructor&m=1,x,2.5,7&p=brisk&d=gallery:30", base);
  assert.equal(state.budgetMin, base.budgetMin);
  assert.equal(state.startTime, base.startTime);
  assert.equal(state.see, "all");
  assert.deepEqual(state.must, [1, 7]);
  assert.equal(fromHash("#b=90", base).budgetMin, base.budgetMin, "only the budgets on offer");
  assert.equal(state.from, "gate", "a link never starts from someone's position");
  assert.deepEqual(Object.keys(state), Object.keys(base), "no walking pace or minutes per stop");
});

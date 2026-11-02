import assert from "node:assert/strict";
import { test } from "node:test";

import { distance } from "../../web/js/format.js";
import { SEE, defaults, fromHash, toHash } from "../../web/js/state.js";

test("distances", () => {
  assert.equal(distance(347), "350 m");
  assert.equal(distance(1234, "en"), "1.2 km");
  assert.equal(distance(1234, "pt-BR"), "1,2 km");
  assert.equal(distance(12_880, "pt-BR"), "12,9 km");
  assert.equal(distance(451_049, "en"), "451 km");
  assert.equal(distance(451_049, "pt-BR"), "451 km");
});

test("settings survive a round trip through a link", () => {
  const state = { ...defaults(), see: "galleries", must: [3386, 3425], exclude: [12] };
  const hash = toHash(state);
  assert.equal(hash, "s=galleries&m=3386,3425&x=12");
  assert.deepEqual(fromHash(`#${hash}`, defaults()), state);
});

test("junk in a link is ignored", () => {
  const base = defaults();
  const state = fromHash("#s=constructor&m=1,x,2.5,7&p=brisk&d=gallery:30", base);
  assert.equal(state.see, "all");
  assert.deepEqual(state.must, [1, 7]);
  assert.equal(state.from, "gate", "a link never starts from someone's position");
  assert.deepEqual(Object.keys(state), Object.keys(base));
});

test("old links with a time limit or a start time still open", () => {
  const state = fromHash("#b=240&t=1015&s=galleries&m=3386", defaults());
  assert.deepEqual(state, { ...defaults(), see: "galleries", must: [3386] });
});

test("everything is art and gardens; botanical highlights are added one by one", () => {
  assert.deepEqual(SEE.galleries, ["gallery"]);
  assert.deepEqual(SEE.all, ["gallery", "outdoor_work", "garden"]);
});

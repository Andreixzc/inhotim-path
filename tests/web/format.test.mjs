import assert from "node:assert/strict";
import { test } from "node:test";

import { distance } from "../../web/js/format.js";
import {
  KINDS,
  covers,
  defaults,
  fromHash,
  isChosen,
  setKind,
  setStop,
  toHash,
} from "../../web/js/state.js";

test("distances", () => {
  assert.equal(distance(347), "350 m");
  assert.equal(distance(1234, "en"), "1.2 km");
  assert.equal(distance(1234, "pt-BR"), "1,2 km");
  assert.equal(distance(12_880, "pt-BR"), "12,9 km");
  assert.equal(distance(451_049, "en"), "451 km");
  assert.equal(distance(451_049, "pt-BR"), "451 km");
});

test("at first: every category but the botanical highlights", () => {
  assert.deepEqual(KINDS, ["gallery", "outdoor_work", "garden", "botanical"]);
  assert.deepEqual(defaults().kinds, ["gallery", "outdoor_work", "garden"]);
});

test("settings survive a round trip through a link", () => {
  const state = { ...defaults(), kinds: ["gallery", "botanical"], must: [3386, 3425] };
  state.exclude = [12];
  const hash = toHash(state);
  assert.equal(hash, "s=gallery,botanical&m=3386,3425&x=12");
  assert.deepEqual(fromHash(`#${hash}`, defaults()), state);
});

test("categories from a link: in the page's order, junk dropped, empty means none", () => {
  const kinds = fromHash("#s=botanical,bogus,gallery", defaults()).kinds;
  assert.deepEqual(kinds, ["gallery", "botanical"]);
  assert.deepEqual(fromHash("#s=&m=7", defaults()), { ...defaults(), kinds: [], must: [7] });
  assert.equal(toHash({ ...defaults(), kinds: [], must: [7] }), "s=&m=7");
});

test("junk in a link is ignored", () => {
  const base = defaults();
  const state = fromHash("#s=constructor&m=1,x,2.5,7&p=brisk&d=gallery:30", base);
  assert.deepEqual(state.kinds, base.kinds);
  assert.deepEqual(state.must, [1, 7]);
  assert.equal(state.from, "gate", "a link never starts from someone's position");
  assert.deepEqual(Object.keys(state), Object.keys(base));
});

test("old links still open: galleries only, everything, a time limit, a start time", () => {
  const state = fromHash("#b=240&t=1015&s=galleries&m=3386", defaults());
  assert.deepEqual(state, { ...defaults(), kinds: ["gallery"], must: [3386] });
  assert.deepEqual(fromHash("#s=all", defaults()).kinds, ["gallery", "outdoor_work", "garden"]);
});

const gallery = { id: 1, kind: "gallery", main_view: true };
const garden = { id: 2, kind: "garden", main_view: true };
const plant = { id: 3, kind: "botanical", main_view: true };
const inside = { id: 4, kind: "work_in_gallery", main_view: false };

test("a stop added or skipped is kept only when it differs from the categories", () => {
  const state = { ...defaults(), kinds: ["gallery"] };
  assert.ok(covers(state, gallery) && !covers(state, plant) && !covers(state, inside));
  setStop(state, plant, true);
  setStop(state, inside, true);
  setStop(state, gallery, false);
  assert.deepEqual([state.must, state.exclude], [[3, 4], [1]]);
  const chosen = [gallery, plant, inside].map((poi) => isChosen(state, poi));
  assert.deepEqual(chosen, [false, true, true]);
  setStop(state, gallery, true);
  setStop(state, plant, false);
  assert.deepEqual([state.must, state.exclude], [[4], []]);
});

test("a category is chosen whole, or not at all", () => {
  const pois = [gallery, garden, plant, inside];
  const state = { ...defaults(), kinds: ["gallery", "garden"], must: [3], exclude: [1, 2] };
  setKind(state, "botanical", true, pois);
  const all = ["gallery", "garden", "botanical"];
  assert.deepEqual(state, { ...defaults(), kinds: all, exclude: [1, 2] });
  setKind(state, "gallery", false, pois);
  assert.deepEqual(state, { ...defaults(), kinds: ["garden", "botanical"], exclude: [2] });
  setKind(state, "gallery", true, pois);
  assert.deepEqual(state.kinds, ["gallery", "garden", "botanical"], "kept in the page's order");
});

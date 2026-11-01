import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { normalize, Park, PlanError } from "../../web/js/plan.js";

// The synthetic park from tests/synthetic_park.py (meters east/north of (0, 0)):
//   1 Recepção (50, 95), 2 Galeria Praça (200, 95), 3 Galeria Lago (350, 95) on the main path;
//   4 Sem título (205, 300) and 5 Jardim Pictórico (300, 385) up north; 6 Obra interna (inside
//   Praça, not on the main map); 7 Galeria Longe (too far from any path).
const data = JSON.parse(readFileSync(new URL("../fixtures/synthetic_park.json", import.meta.url)));
const park = () => new Park(data);
const M = 1 / 111_195.08; // a meter in degrees near (0, 0)
const ids = (plan) => plan.visits.map((visit) => visit.poi?.id ?? null);

test("by default: every main-map stop of the default kinds, from the reception and back", () => {
  const plan = park().plan();
  assert.equal(ids(plan)[0], 1);
  assert.equal(ids(plan).at(-1), 1);
  assert.deepEqual(ids(plan).slice(1, -1).sort(), [2, 3, 4, 5]);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(plan.unreachable.map((poi) => poi.id), [7]);
  assert.equal(plan.feasible, true);
});

test("the timeline adds up, and each leg joins its two visits", () => {
  const plan = park().plan();
  let clock = 0;
  plan.visits.forEach((visit, i) => {
    if (i > 0) {
      clock += plan.visits[i - 1].dwellS + visit.walkS;
      const leg = plan.legs[i - 1];
      assert.deepEqual(leg[0], plan.visits[i - 1].lnglat);
      assert.deepEqual(leg.at(-1), visit.lnglat);
    }
    assert.equal(visit.arriveS, clock);
  });
  assert.equal(plan.legs.length, plan.visits.length - 1);
  assert.equal(plan.totalS, plan.walkS + plan.dwellS);
  assert.equal(plan.dwellS, (20 + 20 + 8 + 10) * 60);
  assert.equal(plan.visits[2].walkS, Math.round(plan.visits[2].walkM / (4 / 3.6)));
});

test("a budget leaves stops out, but must-sees stay in", () => {
  const short = park().plan({ budgetMin: 40 });
  assert.ok(short.totalS <= 40 * 60);
  assert.ok(short.skipped.length > 0);
  assert.deepEqual(
    [...ids(short).slice(1, -1), ...short.skipped.map((poi) => poi.id)].sort(),
    [2, 3, 4, 5],
  );
  const withMust = park().plan({ budgetMin: 40, must: [5] });
  assert.ok(ids(withMust).includes(5));

  const impossible = park().plan({ budgetMin: 5, must: [3] });
  assert.equal(impossible.feasible, false);
  assert.deepEqual(ids(impossible), [1, 3, 1]);
});

test("must-sees can be off the main map, and excluded stops disappear", () => {
  const plan = park().plan({ must: [6], exclude: [3] });
  assert.ok(ids(plan).includes(6));
  assert.ok(!ids(plan).includes(3));
  assert.ok(!plan.skipped.some((poi) => poi.id === 3));
});

test("kinds, pace and minutes per stop change the plan", () => {
  const galleries = park().plan({ kinds: ["gallery"] });
  assert.deepEqual(ids(galleries).slice(1, -1).sort(), [2, 3]);
  const slow = park().plan({ speedKmh: 2 });
  const normal = park().plan();
  assert.ok(Math.abs(slow.walkS - 2 * normal.walkS) <= slow.visits.length);
  assert.equal(park().plan({ dwellMin: { gallery: 30 } }).dwellS, (30 + 30 + 8 + 10) * 60);
  assert.throws(() => park().plan({ kinds: [] }), (error) => error.code === "no-stops");
});

test("starting from a position: walk to the nearest path, end at the reception", () => {
  const here = [120 * M, 90 * M]; // 10 m south of the main path, between Recepção and Praça
  const plan = park().plan({ start: here });
  assert.equal(plan.visits[0].poi, null);
  assert.deepEqual(plan.visits[0].lnglat, here);
  assert.equal(ids(plan).at(-1), 1);
  assert.ok(Math.abs(plan.startOffsetM - 10) < 0.5);
  const first = plan.legs[0];
  assert.deepEqual(first[0], here);
  assert.ok(Math.abs(first[1][1] - 100 * M) < 0.2 * M, "then up onto the path");
  assert.deepEqual(first.at(-1), plan.visits[1].lnglat);
  // The first walk includes the 10 m to the path.
  const toPraca = park().plan({ start: here, kinds: ["gallery"], exclude: [3] });
  assert.ok(Math.abs(toPraca.visits[1].walkM - (10 + 80 + 5)) < 1, `${toPraca.visits[1].walkM}`);
});

test("a position far from every path is refused", () => {
  assert.throws(
    () => park().plan({ start: [1000 * M, 1000 * M] }),
    (error) => error instanceof PlanError && error.code === "far",
  );
});

test("search ignores accents and case, and looks at artists too", () => {
  const p = park();
  assert.deepEqual(p.search("praca").map((poi) => poi.id), [2]);
  assert.deepEqual(p.search("AMILCAR").map((poi) => poi.id), [4]);
  assert.deepEqual(p.search("galeria").map((poi) => poi.id), [2, 3, 7]);
  assert.deepEqual(p.search("  "), []);
  assert.equal(normalize("Jardim Pictórico"), "jardim pictorico");
});

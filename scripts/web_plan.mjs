// Plan routes with the web app's JavaScript planner from the command line. Used by the Python tests
// and by scripts/benchmark_web_solver.py to compare it with the CP-SAT planner.
//
//   node scripts/web_plan.mjs web/data/park.json '{"budgetMin": 240}'
//   node scripts/web_plan.mjs web/data/park.json '[{}, {"budgetMin": 120}]'
//
// Prints one JSON summary per request: POI ids in order, what was left out, times in seconds.

import { readFileSync } from "node:fs";

import { Park } from "../web/js/plan.js";

const [file, requests = "{}"] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/web_plan.mjs PARK_JSON [REQUEST_JSON]");
  process.exit(2);
}
const park = new Park(JSON.parse(readFileSync(file, "utf8")));
const parsed = JSON.parse(requests);
const summaries = (Array.isArray(parsed) ? parsed : [parsed]).map((request) => {
  const started = performance.now();
  const plan = park.plan(request);
  return {
    order: plan.visits.map((visit) => visit.poi?.id ?? null),
    skipped: plan.skipped.map((poi) => poi.id),
    unreachable: plan.unreachable.map((poi) => poi.id),
    feasible: plan.feasible,
    walk_m: plan.walkM,
    walk_s: plan.walkS,
    dwell_s: plan.dwellS,
    total_s: plan.totalS,
    ms: performance.now() - started,
  };
});
console.log(JSON.stringify(Array.isArray(parsed) ? summaries : summaries[0]));

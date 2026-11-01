import assert from "node:assert/strict";
import { test } from "node:test";

import { MinHeap, WalkNetwork } from "../../web/js/network.js";
import { mulberry32 } from "../../web/js/solver.js";

// Three nodes near Inhotim: 0 and 1 about 100 m apart (east-west), 2 about 110 m north of 1.
// Edge 0-1 bends through one interior point, edge 1-2 is stored from 2 to 1, and edge 0-2 is a
// long way round.
const BEND = [-44.2195, -20.1203];
const park = {
  nodes: [
    [-44.22, -20.12],
    [-44.219, -20.12],
    [-44.219, -20.119],
  ],
  edges: [
    [0, 1, 110, [BEND]],
    [2, 1, 111, []],
    [0, 2, 300, [[-44.2205, -20.1195], [-44.22, -20.1185]]],
  ],
};

test("shortest walks follow the cheapest edges, from one or several sources", () => {
  const network = new WalkNetwork(park);
  const tree = network.shortestPaths([[0, 0]]);
  assert.deepEqual([...tree.dist], [0, 110, 221]);
  assert.deepEqual([...tree.via], [-1, 0, 1]);

  const twoSources = network.shortestPaths([
    [0, 50],
    [2, 10],
  ]);
  assert.deepEqual([...twoSources.dist], [50, 121, 10]);
});

test("paths follow the shape of each edge, in the direction walked", () => {
  const network = new WalkNetwork(park);
  const fromZero = network.shortestPaths([[0, 0]]);
  const [zero, one, two] = park.nodes;
  assert.deepEqual(network.pathTo(fromZero, 2), [zero, BEND, one, two]);
  const fromTwo = network.shortestPaths([[2, 0]]);
  assert.deepEqual(network.pathTo(fromTwo, 0), [two, one, BEND, zero]);
  assert.deepEqual(network.pathTo(fromTwo, 2), [two]);
});

test("a free point snaps onto the closest path", () => {
  const network = new WalkNetwork(park);
  // 10 m off the middle of the stretch from the bend to node 1, at a right angle to it.
  const middle = [(BEND[0] + park.nodes[1][0]) / 2, (BEND[1] + park.nodes[1][1]) / 2];
  const [mx, my] = [111_320 * Math.cos((middle[1] * Math.PI) / 180), 110_574];
  const [dx, dy] = [(park.nodes[1][0] - BEND[0]) * mx, (park.nodes[1][1] - BEND[1]) * my];
  const length = Math.hypot(dx, dy);
  const off = [middle[0] + ((10 * dy) / length) / mx, middle[1] - ((10 * dx) / length) / my];
  const snapped = network.snap(off);
  assert.ok(Math.abs(snapped.distance - 10) < 1e-3, `${snapped.distance} m`);
  assert.ok(near(snapped.point, middle));

  const [[u, toU], [v, toV]] = snapped.seeds;
  assert.deepEqual([u, v], [0, 1]);
  assert.ok(Math.abs(toU + toV - 110) < 1e-9, "the two ends share the edge's length");
  assert.ok(toU > toV && toV > 0, "the point is on the second half, nearer node 1");
  assert.deepEqual(snapped.toNode[0], [snapped.point, BEND, park.nodes[0]]);
  assert.deepEqual(snapped.toNode[1], [snapped.point, park.nodes[1]]);

  // Walking on from the snapped point: Dijkstra seeded with both ends of its edge.
  const tree = network.shortestPaths(snapped.seeds);
  assert.ok(Math.abs(tree.dist[2] - (toV + 111)) < 1e-9);
});

test("a point past the end of the network snaps onto the end node", () => {
  const network = new WalkNetwork(park);
  const snapped = network.snap([-44.218, -20.1205]);
  assert.ok(near(snapped.point, park.nodes[1]));
  assert.ok(snapped.seeds.some(([node, meters]) => node === 1 && meters === 0));
  assert.ok(snapped.seeds.every(([, meters]) => meters >= 0));
});

function near(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8; // ~1 mm
}

test("the heap pops in increasing order", () => {
  const rng = mulberry32(5);
  const heap = new MinHeap();
  const values = Array.from({ length: 200 }, () => rng());
  values.forEach((value, i) => heap.push(value, i));
  const popped = [];
  while (heap.size > 0) popped.push(heap.pop()[0]);
  assert.deepEqual(popped, [...values].sort((a, b) => a - b));
});

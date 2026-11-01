// The walking network from park.json: shortest walks over the real paths, their shapes for the
// map, and where a free point (a GPS position) meets the paths. No DOM: also runs under node.

export class WalkNetwork {
  /** @param {{nodes: number[][], edges: [number, number, number, number[][]][]}} park */
  constructor({ nodes, edges }) {
    this.nodes = nodes; // [lng, lat] per node
    this.edges = edges; // [u, v, meters, interior [lng, lat] points from u to v]
    this.adjacency = nodes.map(() => []);
    edges.forEach(([u, v, meters], e) => {
      this.adjacency[u].push([v, meters, e]);
      this.adjacency[v].push([u, meters, e]);
    });
  }

  /**
   * Dijkstra from one or more sources, each with a head start in meters: `[[node, meters], ...]`.
   * Returns the distances to every node and, for each node, the edge it was reached through.
   */
  shortestPaths(sources) {
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const via = new Int32Array(this.nodes.length).fill(-1);
    const heap = new MinHeap();
    for (const [node, meters] of sources) {
      if (meters < dist[node]) {
        dist[node] = meters;
        heap.push(meters, node);
      }
    }
    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      for (const [v, meters, e] of this.adjacency[u]) {
        if (d + meters < dist[v]) {
          dist[v] = d + meters;
          via[v] = e;
          heap.push(d + meters, v);
        }
      }
    }
    return { dist, via };
  }

  /** `[lng, lat]` points from the tree's source to `target`, following each path's shape. */
  pathTo(tree, target) {
    const steps = [];
    for (let node = target; tree.via[node] !== -1; ) {
      const [u, v] = this.edges[tree.via[node]];
      const from = node === v ? u : v;
      steps.push([tree.via[node], from]);
      node = from;
    }
    steps.reverse();
    const coords = [this.nodes[steps.length > 0 ? steps[0][1] : target]];
    for (const [e, from] of steps) {
      const [u, v, , interior] = this.edges[e];
      const forward = from === u;
      coords.push(...(forward ? interior : [...interior].reverse()), this.nodes[forward ? v : u]);
    }
    return coords;
  }

  /**
   * The point of the network closest to `[lng, lat]`. `distance` is how far away it is (m),
   * `seeds` are the two ends of its path with the meters to reach them (for `shortestPaths`),
   * and `toNode` gives the shape from the snapped point to either end.
   */
  snap([lng, lat]) {
    const mx = 111_320 * Math.cos((lat * Math.PI) / 180); // meters per degree, locally
    const my = 110_574;
    let best = null;
    this.edges.forEach(([u, v, meters, interior], e) => {
      const points = [this.nodes[u], ...interior, this.nodes[v]];
      let total = 0;
      for (let i = 1; i < points.length; i++) {
        const ax = (points[i - 1][0] - lng) * mx;
        const ay = (points[i - 1][1] - lat) * my;
        const dx = (points[i][0] - points[i - 1][0]) * mx;
        const dy = (points[i][1] - points[i - 1][1]) * my;
        const length = Math.hypot(dx, dy);
        const t = length > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length ** 2)) : 0;
        const distance = Math.hypot(ax + t * dx, ay + t * dy);
        if (best === null || distance < best.distance) {
          best = { edge: e, segment: i, t, distance, along: total + t * length, points };
        }
        total += length;
      }
      if (best.edge === e) best.scale = total > 0 ? meters / total : 0;
    });
    const { edge, segment, t, distance, along, points, scale } = best;
    const [u, v, meters] = this.edges[edge];
    const [a, b] = [points[segment - 1], points[segment]];
    const point = t === 1 ? b : [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const toU = Math.min(meters, Math.max(0, along * scale));
    return {
      distance,
      point,
      seeds: [
        [u, toU],
        [v, meters - toU],
      ],
      toNode: {
        [u]: [point, ...points.slice(0, segment).reverse()],
        [v]: [point, ...points.slice(segment)],
      },
    };
  }
}

/** Binary min-heap of `[priority, value]` pairs. */
export class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(priority, value) {
    const items = this.items;
    items.push([priority, value]);
    for (let i = items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      for (let i = 0; ; ) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

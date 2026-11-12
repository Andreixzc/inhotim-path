// Plan a visit in the browser, like the Python planner (src/inhotim_path/planner.py): pick the
// stops, work out the walking times over the park's paths, solve, and lay the route out in time.
// No DOM: it also runs in a worker and under node.

import { WalkNetwork } from "./network.js";
import { solve } from "./solver.js";

/** How far from the paths a position can be and still count as inside the park (m). */
export const MAX_SNAP_M = 200;

/** A request that can't be planned. `code` says why: "far", "no-stops" or "unknown-poi". */
export class PlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlanError";
    this.code = code;
  }
}

export class Park {
  /** @param {object} data  park.json, written by `inhotim-path web-data` */
  constructor(data) {
    this.data = data;
    this.defaults = data.defaults;
    this.pois = data.pois;
    this.byId = new Map(data.pois.map((poi) => [poi.id, poi]));
    this.network = new WalkNetwork(data);
    this.trees = new Map(); // node -> shortest walks from it, reused between plans
  }

  /** POIs whose name or artist contains the query, ignoring accents and case. */
  search(query) {
    const needle = normalize(query);
    if (!needle) return [];
    return this.pois.filter(
      (poi) =>
        normalize(poi.name).includes(needle) ||
        poi.artists.some((artist) => normalize(artist).includes(needle)),
    );
  }

  /**
   * @param {object} [request]
   * @param {string[]} [request.kinds]  kinds of stop to visit (their POIs on the main map)
   * @param {number[]} [request.must]  POI ids to visit too, whatever their kind
   * @param {number[]} [request.exclude]  POI ids to leave out
   * @param {number | number[]} [request.start]  a POI id, or a `[lng, lat]` position
   * @param {number} [request.end]  POI id: by default the start POI, or the reception when
   *   starting from a position
   * @param {number} [request.speedKmh]
   * @param {Record<string, number>} [request.dwellMin]  minutes at each kind of stop, for the
   *   timeline only: every stop is visited, so they don't change the route
   * @param {number} [request.seed]
   * @param {number} [request.effort]
   */
  plan(request = {}) {
    const defaults = this.defaults;
    const kinds = new Set(request.kinds ?? defaults.kinds);
    const must = new Set(request.must ?? []);
    const exclude = new Set(request.exclude ?? []);
    const speedKmh = request.speedKmh ?? defaults.speed_kmh;
    const dwellMin = { ...defaults.dwell_min, ...request.dwellMin };

    const start = this.place(request.start ?? defaults.start);
    const end = this.place(request.end ?? (start.poi ? start.poi.id : defaults.start));
    const candidates = this.pois.filter(
      (poi) =>
        ((poi.main_view && kinds.has(poi.kind)) || must.has(poi.id)) &&
        !exclude.has(poi.id) &&
        poi.id !== start.poi?.id &&
        poi.id !== end.poi.id,
    );
    if (candidates.length === 0) {
      throw new PlanError("no-stops", "no stops selected: pick some kinds or must-sees");
    }
    const reachable = candidates.filter((poi) => poi.node !== null);
    const unreachable = candidates.filter((poi) => poi.node === null);

    // Walking times in whole seconds, like the Python planner, so the two agree.
    const speed = speedKmh / 3.6;
    const places = [start, ...reachable.map((poi) => this.place(poi.id)), end];
    const meters = places.map((a) => places.map((b) => this.meters(a, b)));
    const seconds = meters.map((row) => row.map((m) => Math.round(m / speed)));
    const dwell = reachable.map((poi) => Math.round((dwellMin[poi.kind] ?? 0) * 60));
    const solution = solve({ cost: seconds, seed: request.seed ?? 1, effort: request.effort ?? 1 });

    const route = [0, ...solution.order.map((i) => i + 1), places.length - 1];
    const visits = [];
    const legs = [];
    route.forEach((k, position) => {
      const place = places[k];
      const { poi, lnglat } = place;
      const visit = { poi, lnglat, arriveS: 0, dwellS: 0, walkM: 0, walkS: 0 };
      if (position > 0) {
        const previous = visits[position - 1];
        const from = route[position - 1];
        visit.walkM = meters[from][k];
        visit.walkS = seconds[from][k];
        visit.arriveS = previous.arriveS + previous.dwellS + visit.walkS;
        visit.dwellS = position < route.length - 1 ? dwell[k - 1] : 0;
        legs.push(this.leg(places[from], place));
      }
      visits.push(visit);
    });
    const walkS = visits.reduce((total, v) => total + v.walkS, 0);
    const dwellS = visits.reduce((total, v) => total + v.dwellS, 0);
    return {
      request: { kinds: [...kinds], must: [...must], exclude: [...exclude], speedKmh },
      visits,
      legs,
      unreachable,
      walkM: visits.reduce((total, v) => total + v.walkM, 0),
      walkS,
      dwellS,
      totalS: walkS + dwellS,
      startOffsetM: start.offset,
    };
  }

  /** A POI id or a `[lng, lat]` position, as a place on the walking network. */
  place(spec) {
    if (Array.isArray(spec)) {
      const snap = this.network.snap(spec);
      if (snap.distance > MAX_SNAP_M) {
        throw new PlanError("far", `${Math.round(snap.distance)} m from the nearest path`);
      }
      const tree = this.network.shortestPaths(snap.seeds);
      return { poi: null, lnglat: spec, snap, tree, offset: snap.distance };
    }
    const poi = this.byId.get(spec);
    if (poi === undefined || poi.node === null) {
      throw new PlanError("unknown-poi", `no routable POI with id ${spec}`);
    }
    if (!this.trees.has(poi.node)) {
      this.trees.set(poi.node, this.network.shortestPaths([[poi.node, 0]]));
    }
    const tree = this.trees.get(poi.node);
    return { poi, lnglat: [poi.lng, poi.lat], node: poi.node, tree, offset: 0 };
  }

  meters(a, b) {
    if (a === b) return 0;
    if (a.poi && b.poi) return a.tree.dist[b.node];
    if (a.poi) return b.offset + b.tree.dist[a.node];
    if (b.poi) return a.offset + a.tree.dist[b.node];
    throw new Error("a walk needs at least one POI");
  }

  /** The `[lng, lat]` points of the walk from place `a` to place `b`. */
  leg(a, b) {
    if (a.poi && b.poi) return this.network.pathTo(a.tree, b.node);
    const [free, poi] = a.poi ? [b, a] : [a, b];
    const root = this.network.rootOf(free.tree, poi.node);
    const coords = [
      free.lnglat,
      ...free.snap.toNode[root],
      ...this.network.pathTo(free.tree, poi.node).slice(1),
    ];
    return a.poi ? coords.reverse() : coords;
  }
}

/** Accent- and case-insensitive form: "Galeria Praça" -> "galeria praca". */
export function normalize(text) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

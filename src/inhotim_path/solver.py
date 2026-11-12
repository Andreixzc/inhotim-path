"""Route optimization with OR-Tools CP-SAT: the shortest tour through every stop (TSP).

The model is one circuit through the depot and the stops (``AddCircuit``), with a boolean per arc.
Arc i -> j costs ``dwell(i) + walk(i, j)`` seconds, so the chosen arcs add up to the route's total
time. Every stop is visited, so the time at stops is the same in any order: the shortest route is
the one that walks the least. CP-SAT returns the best route found within the time limit and says
when it is proven optimal (``history/decisions/0004-cp-sat-circuit-solver.md``).
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass

from ortools.sat.python import cp_model

from inhotim_path.matrix import WalkMatrix

#: CP-SAT runs a portfolio of search strategies in parallel (ADR 0004). Fixed rather than "all
#: cores" so results don't depend much on the machine.
WORKERS = 8


@dataclass(frozen=True)
class Stop:
    poi_id: int
    dwell_s: int = 0


@dataclass(frozen=True)
class Route:
    order: tuple[int, ...]
    """POI ids in visiting order, starting and ending at the depot."""
    walk_m: float
    walk_s: int
    dwell_s: int
    optimal: bool = False
    """Proven optimal: no route through the same stops walks less."""

    @property
    def total_s(self) -> int:
        return self.walk_s + self.dwell_s


class RouteNotFoundError(RuntimeError):
    """The solver returned no route within its time limit."""


def solve(
    depot: int,
    stops: Sequence[Stop],
    matrix: WalkMatrix,
    *,
    speed_mps: float,
    time_limit_s: float = 5.0,
    workers: int = WORKERS,
) -> Route:
    """Shortest route from ``depot`` through every stop and back, searched for ``time_limit_s``."""
    if any(math.isinf(matrix.distance(depot, s.poi_id)) for s in stops):
        raise ValueError("every stop must be reachable from the depot")
    ids = [depot, *(s.poi_id for s in stops)]
    dwell = [0, *(s.dwell_s for s in stops)]
    walk = [[_seconds(matrix.distance(a, b), speed_mps) for b in ids] for a in ids]
    cost = [[dwell[i] + walk[i][j] for j in range(len(ids))] for i in range(len(ids))]
    nodes, optimal = _circuit(cost, time_limit_s, workers)

    order = tuple(ids[n] for n in nodes)
    return Route(
        order=order,
        walk_m=sum(matrix.distance(a, b) for a, b in itertools.pairwise(order)),
        walk_s=sum(walk[a][b] for a, b in itertools.pairwise(nodes)),
        dwell_s=sum(dwell[n] for n in nodes),
        optimal=optimal,
    )


def _circuit(cost: list[list[int]], time_limit_s: float, workers: int) -> tuple[list[int], bool]:
    """Cheapest circuit from node 0 through every node: (nodes from 0 back to 0, proven optimal)."""
    n = len(cost)
    if n == 1:
        return [0, 0], True
    model = cp_model.CpModel()
    arcs: dict[tuple[int, int], cp_model.IntVar] = {}
    for i in range(n):
        for j in range(n):
            if i != j:
                arcs[i, j] = model.new_bool_var(f"arc_{i}_{j}")
    model.add_circuit([(i, j, var) for (i, j), var in arcs.items()])
    model.minimize(
        cp_model.LinearExpr.weighted_sum(list(arcs.values()), [cost[i][j] for i, j in arcs])
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_workers = workers
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RouteNotFoundError(
            f"no route found in {time_limit_s:g} s ({solver.status_name(status)}); "
            "try a longer time limit"
        )

    successor = {i: j for (i, j), var in arcs.items() if solver.boolean_value(var)}
    nodes = [0]
    while (nxt := successor.get(nodes[-1], 0)) != 0:
        nodes.append(nxt)
    nodes.append(0)
    return nodes, status == cp_model.OPTIMAL


def _seconds(meters: float, speed_mps: float) -> int:
    return round(meters / speed_mps)

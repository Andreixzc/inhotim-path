"""Route optimization with OR-Tools CP-SAT.

One model covers both modes (see ``docs/architecture.md``):

- **TSP** (no budget): every stop is mandatory; minimize total time.
- **Orienteering** (``budget_s``): stops are optional, each with a penalty proportional to its
  value, and the route's total time is capped. The penalty per value unit exceeds any possible
  route time, so the solver maximizes collected value first and only then minimizes time.

The model is one circuit through the depot and the stops (``AddCircuit``); a stop that is left out
takes its self-loop instead. Arc i -> j costs ``dwell(i) + walk(i, j)`` seconds, so the chosen arcs
add up to the route's total time. CP-SAT returns the best route found within the time limit and
says when it is proven optimal (``history/decisions/0004-cp-sat-circuit-solver.md``).

In budget mode, the order of the chosen stops is then re-solved as a plain TSP ("polish"): that
model is much smaller and usually proven optimal in milliseconds.
"""

from __future__ import annotations

import itertools
import math
import time
from collections.abc import Sequence
from dataclasses import dataclass

from ortools.sat.python import cp_model

from inhotim_path.matrix import WalkMatrix

#: CP-SAT runs a portfolio of search strategies in parallel; with a single worker, budget-mode
#: results are much worse (ADR 0004). Fixed rather than "all cores" so results don't depend much
#: on the machine.
WORKERS = 8
#: Share of the time limit reserved for re-solving the order of the chosen stops (budget mode).
POLISH_SHARE = 0.2
MIN_POLISH_S = 0.2


@dataclass(frozen=True)
class Stop:
    poi_id: int
    dwell_s: int = 0
    value: int = 1
    """Importance in budget mode; skipping this stop costs ``value`` units."""
    mandatory: bool = False


@dataclass(frozen=True)
class Route:
    order: tuple[int, ...]
    """POI ids in visiting order, starting and ending at the depot."""
    skipped: tuple[int, ...]
    walk_m: float
    walk_s: int
    dwell_s: int
    optimal: bool = False
    """Proven optimal: no route collects more value, or as much value in less time."""

    @property
    def total_s(self) -> int:
        return self.walk_s + self.dwell_s


class RouteNotFoundError(RuntimeError):
    """The solver returned no route."""


class InfeasibleRouteError(RouteNotFoundError):
    """No route satisfies the constraints (e.g. must-see stops don't fit in the budget)."""


def solve(
    depot: int,
    stops: Sequence[Stop],
    matrix: WalkMatrix,
    *,
    speed_mps: float,
    budget_s: int | None = None,
    time_limit_s: float = 5.0,
    workers: int = WORKERS,
) -> Route:
    """Best route from ``depot`` through ``stops`` and back, found in about ``time_limit_s``."""
    if any(math.isinf(matrix.distance(depot, s.poi_id)) for s in stops):
        raise ValueError("every stop must be reachable from the depot")
    ids = [depot, *(s.poi_id for s in stops)]
    dwell = [0, *(s.dwell_s for s in stops)]
    walk = [[_seconds(matrix.distance(a, b), speed_mps) for b in ids] for a in ids]
    cost = [[dwell[i] + walk[i][j] for j in range(len(ids))] for i in range(len(ids))]

    if budget_s is None:
        nodes, optimal = _circuit(cost, [None] * len(stops), None, time_limit_s, workers)
    else:
        deadline = time.monotonic() + time_limit_s
        penalties = [None if s.mandatory else max(s.value, 1) * (budget_s + 1) for s in stops]
        main_s = time_limit_s * (1 - POLISH_SHARE)
        nodes, optimal = _circuit(cost, penalties, budget_s, main_s, workers)
        if not optimal and len(nodes) > 4:
            nodes = _polish(cost, nodes, max(deadline - time.monotonic(), MIN_POLISH_S), workers)

    order = tuple(ids[n] for n in nodes)
    visited = set(nodes)
    return Route(
        order=order,
        skipped=tuple(ids[n] for n in range(1, len(ids)) if n not in visited),
        walk_m=sum(matrix.distance(a, b) for a, b in itertools.pairwise(order)),
        walk_s=sum(walk[a][b] for a, b in itertools.pairwise(nodes)),
        dwell_s=sum(dwell[n] for n in nodes),
        optimal=optimal,
    )


def _circuit(
    cost: list[list[int]],
    penalties: Sequence[int | None],
    budget_s: int | None,
    time_limit_s: float,
    workers: int,
    hint: Sequence[int] = (),
) -> tuple[list[int], bool]:
    """Cheapest circuit from node 0: (nodes from 0 back to 0, proven optimal).

    ``penalties[i - 1]`` is the cost of leaving node ``i`` out, or None if it is mandatory.
    """
    n = len(cost)
    if n == 1:
        return [0, 0], True
    model = cp_model.CpModel()
    arcs: dict[tuple[int, int], cp_model.IntVar] = {}
    skips: dict[int, cp_model.IntVar] = {}
    for i in range(n):
        for j in range(n):
            if i != j:
                arcs[i, j] = model.new_bool_var(f"arc_{i}_{j}")
    for i, penalty in enumerate(penalties, start=1):
        if penalty is not None:
            skips[i] = model.new_bool_var(f"skip_{i}")
    circuit = [(i, j, var) for (i, j), var in arcs.items()]
    circuit += [(i, i, var) for i, var in skips.items()]
    if len(skips) == n - 1:  # all optional: allow the empty route (nothing fits)
        empty = model.new_bool_var("empty")
        circuit.append((0, 0, empty))
        for var in skips.values():
            model.add_implication(empty, var)
    model.add_circuit(circuit)

    route_time = cp_model.LinearExpr.weighted_sum(
        list(arcs.values()), [cost[i][j] for i, j in arcs]
    )
    if budget_s is not None:
        model.add(route_time <= budget_s)
    left_out = cp_model.LinearExpr.weighted_sum(
        list(skips.values()), [penalties[i - 1] for i in skips]
    )
    model.minimize(route_time + left_out)
    if hint:
        used = set(itertools.pairwise(hint))
        for (i, j), var in arcs.items():
            model.add_hint(var, (i, j) in used)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_workers = workers
    status = solver.solve(model)
    if status == cp_model.INFEASIBLE:
        raise InfeasibleRouteError(
            "no feasible route: the mandatory stops don't fit in the time budget"
        )
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


def _polish(
    cost: list[list[int]], nodes: list[int], time_limit_s: float, workers: int
) -> list[int]:
    """Re-solve the visiting order of an already chosen set of stops as a plain TSP."""
    chosen = nodes[:-1]
    sub_cost = [[cost[a][b] for b in chosen] for a in chosen]
    position = {node: k for k, node in enumerate(chosen)}
    try:
        sub_nodes, _ = _circuit(
            sub_cost,
            [None] * (len(chosen) - 1),
            None,
            time_limit_s,
            workers,
            hint=[position[node] for node in nodes],
        )
    except RouteNotFoundError:
        return nodes
    polished = [chosen[k] for k in sub_nodes]
    return polished if _length(cost, polished) < _length(cost, nodes) else nodes


def _length(cost: list[list[int]], nodes: Sequence[int]) -> int:
    return sum(cost[a][b] for a, b in itertools.pairwise(nodes))


def _seconds(meters: float, speed_mps: float) -> int:
    return round(meters / speed_mps)

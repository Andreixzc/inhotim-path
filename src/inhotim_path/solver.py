"""Route optimization with OR-Tools.

One model covers both modes (see ``docs/architecture.md``):

- **TSP** (no budget): every stop is mandatory; minimize total time.
- **Orienteering** (``budget_s``): stops are optional, each with a penalty proportional to its
  value, and a time dimension caps the route. The penalty per value unit exceeds any possible
  route time, so the solver maximizes collected value first and only then minimizes time.

Arc cost i -> j is ``dwell(i) + walk(i, j)`` in seconds; the route starts and ends at the depot.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from inhotim_path.matrix import WalkMatrix


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

    @property
    def total_s(self) -> int:
        return self.walk_s + self.dwell_s


class InfeasibleRouteError(RuntimeError):
    """No route satisfies the constraints (e.g. must-see stops don't fit in the budget)."""


def solve(
    depot: int,
    stops: Sequence[Stop],
    matrix: WalkMatrix,
    *,
    speed_mps: float,
    budget_s: int | None = None,
    time_limit_s: float = 5.0,
) -> Route:
    ids = [depot, *(s.poi_id for s in stops)]
    dwell = [0, *(s.dwell_s for s in stops)]
    walk = [[_seconds(matrix.distance(a, b), speed_mps) for b in ids] for a in ids]
    if any(math.isinf(matrix.distance(depot, s.poi_id)) for s in stops):
        raise ValueError("every stop must be reachable from the depot")

    manager = pywrapcp.RoutingIndexManager(len(ids), 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def transit(from_index: int, to_index: int) -> int:
        i, j = manager.IndexToNode(from_index), manager.IndexToNode(to_index)
        return dwell[i] + walk[i][j]

    callback = routing.RegisterTransitCallback(transit)
    routing.SetArcCostEvaluatorOfAllVehicles(callback)

    if budget_s is not None:
        routing.AddDimension(callback, 0, budget_s, True, "time")
        for node, stop in enumerate(stops, start=1):
            if not stop.mandatory:
                penalty = max(stop.value, 1) * (budget_s + 1)
                routing.AddDisjunction([manager.NodeToIndex(node)], penalty)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.FromMilliseconds(max(int(time_limit_s * 1000), 1))
    solution = routing.SolveWithParameters(params)
    if solution is None:
        raise InfeasibleRouteError(
            "no feasible route: the mandatory stops don't fit in the time budget"
        )

    nodes: list[int] = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        nodes.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    nodes.append(0)

    order = tuple(ids[n] for n in nodes)
    visited = set(nodes)
    return Route(
        order=order,
        skipped=tuple(ids[n] for n in range(1, len(ids)) if n not in visited),
        walk_m=sum(matrix.distance(a, b) for a, b in itertools.pairwise(order)),
        walk_s=sum(walk[a][b] for a, b in itertools.pairwise(nodes)),
        dwell_s=sum(dwell[n] for n in nodes),
    )


def _seconds(meters: float, speed_mps: float) -> int:
    return round(meters / speed_mps)

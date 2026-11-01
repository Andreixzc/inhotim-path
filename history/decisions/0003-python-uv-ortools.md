# 0003: Python pipeline managed with uv, OR-Tools as the routing solver

- **Status:** accepted; the choice of the OR-Tools *routing library* is superseded by [0004](0004-cp-sat-circuit-solver.md) (OR-Tools CP-SAT)
- **Date:** 2026-11-01

## Context

The core of the project is a data and optimization pipeline: HTTP fetching, geometry (snapping,
clipping, line noding), graph shortest paths and vehicle-routing style optimization.

## Decision

- **Language:** Python (≥ 3.12; developed on 3.14). It has the strongest ecosystem for this problem.
- **Tooling:** [uv](https://docs.astral.sh/uv/) for environments and a lockfile, `ruff` for lint and format, `pytest`.
- **Libraries:** `httpx` (HTTP), `shapely` (geometry), `networkx` (graph and shortest paths), `svgelements`
  (SVG path parsing), and **Google OR-Tools** (routing).
- **Why OR-Tools:** one model covers every variant we care about:
  - TSP ("see everything", a closed tour from the reception);
  - Orienteering / prize-collecting TSP ("best route in N hours", via optional nodes with penalties = value);
  - time windows (galleries' opening hours) and multiple vehicles (= multiple days).

## Consequences

- ✅ Fast to prototype, with mature and well-documented libraries.
- ⚠️ OR-Tools does not run in the browser. The future web app (phase 3) will need one of: precomputed routes,
  a small API, or a lightweight TypeScript heuristic (2-opt / insertion) on a precomputed matrix.
  To be decided in phase 3.

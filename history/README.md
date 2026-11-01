# history/: project memory

This folder is the **shared memory** of the project. It records what was done, what was decided
and why, so that any future session (you, a collaborator, or an AI assistant with no prior context)
can pick up exactly where the last one stopped.

Code shows *what* the project is. This folder explains *how it got there* and *what comes next*.

## Layout

| Path | What goes there |
|------|-----------------|
| `sessions/YYYY-MM-DD-NN-slug.md` | One log per working session: goal, what happened, findings, decisions, open questions, next steps. |
| `decisions/NNNN-slug.md` | Lightweight ADRs (Architecture Decision Records): context → decision → consequences. |

## Rules of thumb

1. **Start of a session:** read this file, the latest session log and the decision index below.
2. **End of a session:** write or update the session log, and keep the "Next steps" section current.
   It is the hand-off note for the next session.
3. **Decisions are append-only.** Don't rewrite an old ADR. If a decision changes, add a new ADR
   that *supersedes* the old one and mark the old one's status.
4. Keep entries short and factual. Link to `docs/` for living documentation and to commits/PRs for details.
5. Record dates as absolute dates (`2026-11-01`), never "yesterday" or "last week".

## Index

### Sessions
- [2026-11-01 #01: Kickoff, then Phase 1](sessions/2026-11-01-01-kickoff.md): idea refinement, data-source research, repo setup, then the whole CLI (fetch + route, CP-SAT solver, CI).

### Decisions
- [0001: Use the official map's marker feed as the POI source](decisions/0001-official-map-marker-feed-as-poi-source.md)
- [0002: Walking network = OpenStreetMap + official axes SVG](decisions/0002-walking-network-osm-plus-official-axes.md)
- [0003: Python pipeline managed with uv, OR-Tools as solver](decisions/0003-python-uv-ortools.md) (solver part superseded by 0004)
- [0004: CP-SAT circuit model instead of the OR-Tools routing library](decisions/0004-cp-sat-circuit-solver.md)
- [0005: A stop is worth its viewing minutes](decisions/0005-stop-value-is-viewing-time.md)
- [0006: HTML map basemap from OpenFreeMap (MapLibre), not OSM's tile servers](decisions/0006-basemap-openfreemap.md)

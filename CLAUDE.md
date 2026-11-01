# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

**Project:** `inhotim-path`, a route planner for the Inhotim museum (Brumadinho, MG, Brazil) built from
the museum's live map. It reads the map, builds a walking graph and solves TSP / orienteering routes.

## Start of every session

1. Read `history/README.md`, then the **latest** log in `history/sessions/` (its "Next steps" section
   is the hand-off), then skim `history/decisions/`.
2. Check `docs/roadmap.md` for the current phase.

## End of every session (or after a meaningful chunk of work)

- Update the current session log in `history/sessions/` (create `YYYY-MM-DD-NN-slug.md` for a new session).
- If an architectural decision was made or changed, add an ADR in `history/decisions/` (append-only).
- Keep the index in `history/README.md` in sync.

## Commits

- The owner wants a granular, visible history on GitHub: **commit as you go** in small, focused commits,
  and push to `origin main`.
- Use Conventional Commits: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`, `ci`, `data`.
- Never commit secrets, raw page dumps, or third-party images/texts (see data etiquette below).

## Dev commands

```bash
uv sync                      # install deps (creates .venv)
uv run pytest                # tests
uv run ruff check .          # lint
uv run ruff format .         # format
uv run inhotim-path --help   # CLI
```

## Data etiquette

- Fetch from `inhotim.org.br` sparingly: snapshot into `data/`, never in a hot loop, with an identifying User-Agent.
- Store only factual metadata (names, coordinates, categories, links). No photos or descriptions.
- OpenStreetMap-derived data is ODbL: keep the attribution in README and outputs.
- Details about every endpoint and its quirks: `docs/data-sources.md`.

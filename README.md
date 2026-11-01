# inhotim-path

**Plan the best walking route through [Inhotim](https://www.inhotim.org.br/), built from the museum's live map.**

Inhotim (Brumadinho, MG, Brazil) is an open-air contemporary art museum and botanical garden.
Its galleries, outdoor artworks and themed gardens are spread across a large, hilly park, and
the collection changes over time. The official map shows *where* things are, but not *in which
order* to see them.

`inhotim-path` reads the museum's live map, turns it into a walking graph, and computes:

- 🧭 **the shortest route to see everything**: a Traveling Salesman Problem (TSP) over real walking paths;
- ⏱️ **the best route for the time you have**: an Orienteering Problem that maximizes what you see within a time budget;
- 📅 *(planned)* multi-day plans, must-see lists, accessibility options and live GPS re-routing.

> 🚧 **Status:** early development. See the [roadmap](docs/roadmap.md).

## How it works

```
Inhotim live map  ──► POIs (galleries, works, gardens) ─────────────┐
Official axes SVG ──► georeferenced routes ──┐                       ├─► snap POIs ─► walking-time matrix ─► solver ─► route
OpenStreetMap     ──► footpaths + park boundary ─► walking graph ────┘
```

More detail: [vision](docs/vision.md) · [data sources](docs/data-sources.md) · [architecture](docs/architecture.md)

## Quickstart

_Coming soon: the CLI is being built in Phase 1._

## Project memory

This repo keeps a running log of working sessions and decisions in [`history/`](history/), so anyone
(human or AI assistant) can pick up exactly where the last session stopped.

## Disclaimer

Independent hobby project, **not affiliated with Instituto Inhotim**. Map data is fetched from the
museum's public website, and only factual metadata (names, coordinates, categories, links) is stored:
no photos or texts. Path data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).

## License

[MIT](LICENSE)

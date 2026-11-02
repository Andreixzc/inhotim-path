# 0011: What "galleries" and "everything" cover

- **Status:** accepted; the choice of "everything" is replaced by choosing categories
  ([0012](0012-choose-what-to-see-by-category.md)), which start with the same three
- **Date:** 2026-11-01

## Context

- Andrei noticed that Doug Aitken's Sonic Pavilion wasn't a gallery: it was green on the map, and missing from
  "galleries only". In Andrei's words: *"i think i was vague with the 'galery' only, idk whats the best
  semanthics for it"*.
- Kinds came straight from the map's categories ([0001](0001-official-map-marker-feed-as-poi-source.md)). The map
  files four artist galleries under outdoor works (`obras-a-ceu-aberto`), in every copy of their markers: Doug
  Aitken, Cristina Iglesias, Valeska Soares and Marilá Dardot. Yet their pages in Inhotim's collection are named
  like every other gallery's (`/item-do-acervo/galeria-doug-aitken/`), and the official app lists "Galeria Cristina
  Iglesias". Only the map's category says otherwise.
- "Everything" included the 31 botanical highlights: single plants, so 89 stops and 12.9 km. The page before the
  redesign left them out by default. Andrei: *"yes, leave the botanical highlights out."*

Options for "galleries only":

| Option | Verdict |
|---|---|
| **What Inhotim calls a gallery**: its map category, or a collection page named `galeria-…` | ✅ Inhotim's own naming, and the daily refresh keeps it up to date |
| Rename the choices "art" vs "everything" | ❌ Art would be 49 stops and everything 58: too close to be worth a choice |
| A hand-picked list of "pavilions" | ❌ A call on each work, which no refresh can make. "Palm Pavilion" and "The Mahogany Pavilion" have the word in their names, but Inhotim doesn't call them galleries |

## Decision

- **A gallery is what Inhotim calls one:** a marker in the `galeria` or `artista` category, or an outdoor work
  whose page is `/item-do-acervo/galeria-…`. This is applied when the feed is read, so `data/pois.json`, the
  command line, the HTML map and the web app all agree.
- **"Everything" means galleries, outdoor works and themed gardens.** Botanical highlights stay on the map as
  dots, and any of them can be added to the route from the search box or its popup. The command line already
  left them out by default (`--botanical` adds them).

## Consequences

- ✅ "Galleries only" includes the four artist galleries: 23 stops and 8.4 km of walking (before: 19 and 7.6 km).
  On the map they're red, like the other galleries.
- ✅ "Everything" is 58 stops and 11.8 km (before: 89 and 12.9 km). It plans in about 40 ms on a laptop.
- ⚠️ It depends on Inhotim's page naming. If a page is renamed, its stop falls back to an outdoor work. The
  daily refresh lists kind changes in its commit message (`~ Doug Aitken: gallery -> outdoor_work`), so it would
  show.
- ⚠️ On the command line these four now count 20 minutes each instead of 8. Seeing everything takes 15h35
  instead of 14h47. The best 6-hour route still has 24 stops.

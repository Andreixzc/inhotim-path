# 0013: The museum's words for the categories, and choosing by artist

- **Status:** accepted
- **Date:** 2026-11-01

## Context

- The category chips ([0012](0012-choose-what-to-see-by-category.md)) used our own words: "Obras ao ar livre",
  "Jardins". On the museum's map they are "Obras a céu aberto" and "Jardins temáticos". Andrei: *"yes use their
  wording, and add the artist option too."*
- The map's filters also include Artistas. The feed credits each point to its artists (`artists_names`, or the
  info window's subtitles). Among the points a route can reach there are 39 artists. Seven have more than one
  stop (Tunga: two galleries and an outdoor work). Three are on the map only through a work inside a gallery
  (Janet Cardiff, Victor Grippo, Gisela Motta e Leandro Lima). One stop has two artists: Galeria Cosmococa
  (Hélio Oiticica and Neville D'Almeida).
- Yayoi Kusama's gallery is pinned on the map as the artist herself (group `artista`), and the feed credits that
  pin to no one.

## Decision

- **Words:** the chips and the picker use the map's words: Galerias, Obras a céu aberto, Jardins temáticos,
  Destaques botânicos, Artistas (in sentence case). In English, the museum's English map: Galleries, Themed
  gardens, Botanical highlights, Artists. "Open-air construction" there is a mistranslation, so we say
  "Open-air works".
- **Artists** is a group in the picker, after the four categories. An artist's stops are their points on the map:
  galleries, outdoor works, gardens. A work inside a gallery counts only for an artist with nothing else on the map.
- An artist's box adds or skips all their stops, through the stops added and skipped that the settings already
  keep (`m`, `x`). It is ticked when all of them are on the route, and shows a dash when only some are. The
  group's count ("35 of 39") counts the artists with all their stops on the route. There's no new setting, and
  links and saved plans stay as they were.
- The parser credits a pin in the `artista` group to the artist it's named after, so Kusama's gallery is hers.
- Artists have no color on the map. Their boxes use the green of the start and finish markers.

## Consequences

- ✅ "I want to see Tunga" is one tap. With no categories chosen, Tunga, Kusama and Janet Cardiff make a walk of
  6 stops and 3.8 km.
- ✅ The main screen doesn't change: artists are in "Customize", with the stop-by-stop choices.
- ⚠️ A shared stop links two artists' boxes: adding Hélio Oiticica also ticks Neville D'Almeida, whose only stop
  is Galeria Cosmococa.
- ⚠️ Unticking an artist skips their stops even where a chosen category covers them. Choosing that category again
  brings them back, like any stop skipped one by one.
- ⚠️ Names come from the feed as they are: a duo is one artist ("John Ahearn & Rigoberto Torres").

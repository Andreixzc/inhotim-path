# 0012: Visitors choose what to see by category, and stop by stop in a picker

- **Status:** accepted
- **Date:** 2026-11-01

## Context

- The page offered two choices: galleries only, or everything ([0010](0010-web-app-without-times.md),
  [0011](0011-what-galleries-and-everything-cover.md)). Andrei asked: *"what are the classifications? [...] is
  this public? if it is, we could just let the users pick. like, 'i want to see galerys and botanic things' [...]
  then add an detailed option aswell for each subject, to give fredom to the user to pick exataclty what he wants
  to see, but on a separated menu to keep things minimalists."*
- The categories are Inhotim's own, and public. The museum's map page has a filter for each (Galerias, Obras a
  céu aberto, Jardins temáticos, Destaques Botânicos, Obras em galerias, plus Artistas), and its marker feed gives
  each point one (`group`). Four are places to visit: galleries (23, counted as in
  [0011](0011-what-galleries-and-everything-cover.md)), outdoor works (26), themed gardens (9) and botanical
  highlights (31). The rest aren't stops a visitor picks from a list: works inside galleries (38, inside their
  gallery's building), services (9), events (13, dated programs) and exhibitions (1). The feed says nothing about
  the medium (painting, sculpture, video…).

## Decision

- **Main screen:** a chip per category, in the map's color for it, in any combination. At first: galleries,
  outdoor works and gardens. Botanical highlights start off, as before
  ([0011](0011-what-galleries-and-everything-cover.md)).
- **"Customize"** opens a picker in a panel of its own (the whole screen on phones, over the sidebar on wider
  screens). Each category lists its stops as checkboxes, has a box for the whole category, and shows a count
  ("22 of 23"). Its search also finds works inside galleries, services and events, under "Other".
- **Settings:** `s` lists the categories (`s=gallery,botanical`, or `s=` for none). `m` and `x` keep the stops
  added and skipped, only where they differ from the categories. Choosing or dropping a whole category forgets
  its stops picked one by one. Old links still open: `s=galleries` is the galleries, `s=all` the first three.
- The search box, the added-stop chips and the "skipped by you" list leave the main screen: the picker does all
  three. The "Customize" row says how many stops were added or skipped. Popups keep Skip and Add.

## Consequences

- ✅ Any mix: galleries and botanical highlights is 54 stops and 10.9 km; galleries only is 23 stops and 8.4 km.
- ✅ The main screen stays small: four chips and one row. The chips also explain the map's colors.
- ⚠️ The main screen can't find a stop on the route by name any more. The list and the map still show every
  stop.
- ⚠️ The picker lists up to 89 stops. Its groups start closed, and the search narrows them.

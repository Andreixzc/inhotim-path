# 0018: Visitors mark stops as seen, on their phone

- **Status:** accepted
- **Date:** 2026-11-12

## Context

- Andrei: *"Can we add something feature that the people could see himself on the map? like a gps? and also enable
  him to mark the things he saw, so he wouldnt have to see redudnat stuff on the map?"*
- Seeing yourself already worked: the map's locate button (MapLibre's `GeolocateControl`) shows a live dot, and
  "Minha localização" plans from where you are. What was missing was a way to say what you've seen, and a route
  that goes on with the rest.
- Asked how seen stops should look, what the GPS should do, and how long marks should last, Andrei chose *"fade
  them, suggest only, keep until cleared"*.
- The web app has no server, and a shared link carries a plan's settings.

## Decision

- **Marking:** "Já vi" ("Seen it") in a route stop's popup, and a round check button on its row in the list.
  - A seen stop leaves the route.
  - The map keeps it, smaller and faded, in its category's color with a check. Its popup says it's seen and offers
    "Desmarcar".
  - A "Já vistas" section under the route lists the seen stops, the latest first, each with a button that unmarks
    it. "Começar de novo" clears them all, after a confirm.
- **Kept on the phone** (`localStorage`, `web/js/seen.js`) until cleared, with when each stop was marked. Never in
  the link: sharing a plan doesn't share anyone's visit. Marks for stops the park no longer lists are dropped.
- **The route goes on from the stop seen last**, if that was today, and ends at the Portaria.
  - The start's choice then has neither option selected, and a note under it names that stop.
  - Choosing the Portaria starts there again, until the next mark. "Minha localização" starts from the position,
    and marking a stop moves that start to the newest position, if it's accurate to 100 m.
  - On another day the route starts at the Portaria, and the marks stay: a visit over two days.
- **The GPS only suggests.** While the position is on ("Minha localização", or the map's locate button), a route
  stop where the visitor stays for two minutes gets a card at the top of the sheet: "Você está em … Já viu?", with
  "Já vi" and a button that dismisses it.
  - Near is within 40 m of the stop, and walking off is past 70 m, so GPS drift doesn't restart the wait. Fixes
    vaguer than 60 m don't count.
  - Each stop is suggested once.
  - The position stays on the phone.

## Alternatives

- **Hide seen stops:** a cleaner map, but the visitor loses track of where they've been, and can't unmark a stop
  from the map.
- **Mark stops automatically within ~25 m** (the roadmap's first idea): paths pass right by works, a visitor can
  walk past one without looking, and GPS drifts under trees and in galleries. A wrong mark would take a stop off
  the route without a word.
- **Marks that reset each day:** a visit over two days would lose them overnight.
- **Marks in the shared link:** sharing a plan would share the visit.
- **Always go on from the GPS position:** many visitors plan before they arrive, and the position is off unless
  they turn it on. The stop seen last is where they are, near enough.

## Consequences

- ✅ The route gets shorter as the visit goes on, and starts where the visitor left off.
- ✅ Nothing leaves the phone.
- ⚠️ Marks live in one browser: another phone, a private tab or cleared site data starts empty.
- ⚠️ Suggestions need the page open: a phone in a pocket with its screen off pauses it.
- ⚠️ A route from a stop seen ends at the Portaria, so the map shows two flags, as when starting from your
  position.

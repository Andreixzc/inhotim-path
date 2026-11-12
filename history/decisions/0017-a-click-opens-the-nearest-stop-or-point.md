# 0017: A click opens the nearest stop or point within reach

- **Status:** accepted
- **Date:** 2026-11-12

## Context

- Andrei: *"its very dificult to click on the actual atraction [...] i need to focus my mouse very precisly, and on
  mobile is even wrost"*.
- The park's points off the route are dots with a 3 to 6 px radius (by zoom) and a 1 px rim, and MapLibre only
  counted a click that landed on one. Measured in Chrome:
  - A dot opened within 4 to 6 px of its center with a mouse, and within 2 to 4 px with a finger.
  - A route stop's marker (26 px) opened within 12 px of its center.
- A bug made it worse: with a popup open, a click on another dot closed the popup instead of opening the other
  one. MapLibre's close-on-click ran after the click had opened the new popup.

## Decision

- **Nearest within reach** (`web/js/pick.js`): a click opens whichever stop or point has its edge nearest to the
  click, if that edge is within reach. The reach is 8 px for a mouse and 20 px for a finger (the click's
  `pointerType`, or the device's main pointer when the browser doesn't say). Under the click, the nearest center
  wins.
- **Markers** still take the clicks that land on them, so overlapping stops open the one on top, as before. The
  rule covers the dots and clicks just off a marker.
- **The popup** closes only on a click with nothing in reach, and clicks inside it are ignored.
- **With a mouse,** what a click would open shows under it: a pointer cursor, and the dot grows or the stop's
  marker gets a ring.
- Nothing changes in how the map looks until the mouse comes near.

## Alternatives

- **Bigger dots:** they'd crowd a map that already has 58 stops, and a finger needs about 48 px.
- **An invisible, wider circle layer under the dots:** it covers only the dots, with one size for mice and
  fingers, and the nearest dot doesn't win where hit areas overlap.
- **Grouping nearby points** into clusters that open into a list: more to build and to learn. The itinerary already
  lists every stop.

## Consequences

- ✅ Measured again: with a mouse, a dot opens up to 12 to 14 px from its center and a stop up to 20 px. With a
  finger, a lone dot opens up to 26 px from its center and a stop up to 32 px.
- ✅ A click on another dot moves the popup there.
- ⚠️ A click on empty map just beside a dot opens the dot instead of closing the popup.
- ⚠️ Where points are a few px apart, a finger still can't choose between them: zoom in, or use the list.

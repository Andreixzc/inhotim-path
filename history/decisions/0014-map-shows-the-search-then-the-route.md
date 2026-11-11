# 0014: The map shows the search, then draws the route

- **Status:** accepted
- **Date:** 2026-11-11

## Context

- The browser plans a route in about 40 ms (58 stops; 131 ms for all 89 on a laptop), so a tap showed the new
  route at once. Andrei found that counter-intuitive (*"i tought the the salesman problem would take more time to
  load"*) and asked for something to make the site more dynamic: *"some blinking paths to simulate that we are
  actually calculating the path? could be a fixed animation, like blinking the paths"*.
- Planning has two steps. A shortest-path search runs from every stop (Dijkstra, about 8 ms for the whole park), then
  the solver puts the stops in order. The first step is easy to picture: a wave that spreads along the paths and
  reaches places in order of walking distance.

## Decision

- After a new route is planned, the map plays a fixed animation of about 1.3 s (`web/js/reveal.js`, `TIMING`):
  1. **Search:** the previous route fades out, and a wave spreads from the start along every path of the park at a
     steady pace, like the real search. What it has reached glows faintly in the route's orange, and its front
     blinks in a lighter orange.
  2. **Flash:** the whole network flashes once when the wave reaches the farthest path.
  3. **Route:** the route is drawn from the start to the finish, with a dot at its tip. Each stop appears with a ping
     when the line reaches it.
- **Summary:** it says "Finding the shortest walk…" with the old distance dimmed, then counts to the new distance
  as the route is drawn. Screen readers hear only the result (`aria-busy` while the animation plays).
- **Planned first:** the route is fully planned before the animation starts. The timing is fixed and doesn't follow
  the solver.
- **Drawing:** the animation is drawn on a canvas above the map and below the markers, with the map's route layers
  hidden. At the end, the map's own layers draw the route again, so the finished map looks exactly as before.
- **When it doesn't play:**
  - for a route that's already shown, e.g. after a language switch;
  - behind the picker (it plays once when the picker closes);
  - when the visitor's system asks for less motion (`prefers-reduced-motion`).

## Alternatives

- **Replaying the solver's real routes** as it improves them: true to the computation, but the improvements are
  small and hard to see. Routes of up to 12 stops are solved exactly, with no in-between routes to show.
- **Animating MapLibre's own layers** (feature states, line gradients): every frame becomes a style update, which
  is slower, and the effect gets tied to the map's style. A canvas is simple, and fast enough: 60 frames a second
  with Chrome's CPU slowed 4×, and one dropped frame at 6×.

## Consequences

- ✅ A change of plan looks like work being done. The route reads as a walk from the entrance, stop by stop.
- ✅ The wave is a faithful picture of the search: it really does reach places in order of walking distance.
- ⚠️ The new route is complete on screen about 1.3 s after a tap, instead of about 0.2 s. A tap during the animation
  starts it over.
- ⚠️ While the animation plays, the canvas draws over the map's labels.
- ⚠️ The timing is a matter of taste. It lives in one place (`TIMING`), so it's easy to tune.

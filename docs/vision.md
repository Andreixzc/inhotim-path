# Vision: the idea, refined

## One-liner

A route planner for Inhotim that reads the museum's **live map** and tells you **in which order to visit**:
the whole collection, or the best of it for the time you have.

## The goal: a simple web app

Andrei (2026-11-01): *"make this a simple webapp to help people plan their routes before or when they are
already there."* That means two moments, both on a phone:

- **Before the visit**, at home: pick the time you have and your must-sees, then see the route on a map or on
  satellite imagery.
- **During the visit**, in the park: see where you are, tick off what you've seen, and re-plan with the time
  left. Mobile signal may be patchy in a big park, so the app should keep working offline once it's loaded.

## The problem

- **Inhotim is big and hilly.** Around 23 galleries, 26 outdoor works and 9 themed gardens are spread across
  a large park and connected by winding paths. The only guidance is three colored routes ("eixos").
- **The official map answers "where is X?", not "what should I see next?"** Visitors backtrack, miss a work
  that was a few minutes away, or run out of time on the far side of the park.
- **The collection changes.** Galleries reopen, works rotate, and temporary exhibitions come and go. Any static
  guide or hand-made route goes stale.

## From "shortest route" to "best route"

**Original idea:** *generate the shortest route to visit everything in the least amount of time, reading the
official map dynamically.*

### 1. "Visit everything, minimum time" is a TSP

Model the park as a **graph**: path junctions are nodes, and path segments are edges weighted by walking time.
Visiting every attraction once and coming back to the reception in minimum time is the
**Traveling Salesman Problem**. With ~60 stops it is NP-hard in theory but easy in practice: OR-Tools' CP-SAT
proves the optimal tour through the 58 default stops in about 0.2 s.

Two important details:

- **Distances must come from real paths, not straight lines.** Two works facing each other across a lake can be
  several times farther apart on foot. So we build a walking graph (OpenStreetMap + the official routes),
  compute the shortest walking time between every pair of stops (a *distance matrix*), and only *then* solve
  the TSP over that matrix.
- **Dwell time doesn't change the optimal order when you visit everything**, because the sum is constant. It
  still matters for the timeline (when you'll reach each stop) and for everything below.

### 2. Reality check: "everything" probably doesn't fit in one day

Back-of-the-envelope with the current map: ~23 galleries × 20 min + ~26 outdoor works × 8 min + 9 gardens × 10 min
≈ **12½ hours of looking, before walking a single meter**.

The engine's answer (2026-11-01 data): the optimal tour has **58 stops: 12h38 at stops plus 11.8 km of walking
(2h57) = 15h35**. The dwell times are assumptions, but the conclusion holds: seeing everything takes about two
days.

### 3. So the useful question is "I have N hours: what should I see, and in what order?"

That's the **Orienteering Problem** (also called the prize-collecting TSP). Every stop has a *value*, and the goal
is to maximize the total value within a time budget, starting and ending at the reception. Two days means two
tours that never repeat a stop: the **Team Orienteering Problem**.

A stop is worth its viewing minutes ([ADR 0005](../history/decisions/0005-stop-value-is-viewing-time.md)), so the
best route spends the most time with art and then walks the least. Per-category weights were tried first, and
they flipped between "all outdoor works" and "all galleries". Visitors steer with must-sees today (in the web
app, by category, stop or artist); "only what's new" can come later.

### 4. One engine for all of it

One CP-SAT circuit model covers both modes: optional stops take a self-loop, and a constraint caps the total time
([ADR 0004](../history/decisions/0004-cp-sat-circuit-solver.md)). The original "see everything" TSP is the
special case with no optional stops. Time windows (opening hours) and one circuit per day (multi-day plans) fit
the same model.

## Who it's for

| Visitor | What they ask | Mode |
|---|---|---|
| Completionist | "Everything, shortest route." | TSP |
| First-timer, one day | "Best route for 6 hours?" | Orienteering |
| Two-day visitor | "Split everything into two balanced days." | Team orienteering |
| Returning visitor | "Only what's new since my last visit." | Filtered TSP |
| Art or botany lover | "Only galleries." / "Gardens and botanical highlights." | Filtered TSP / orienteering |
| Limited mobility *(later)* | "Avoid steep paths." | Slope-aware costs |

## Product principles

1. **Always fresh.** Data comes from the official live map and is refreshed automatically. No hand-maintained lists.
2. **Honest estimates.** Walking times come from real paths (later also slope); dwell times are explicit and adjustable.
3. **Works on site.** The final app should cope with poor connectivity: precomputed data, routes computed on the device.
4. **Respectful of the source.** Polite, cached fetching, factual metadata only, clear attribution, and no
   affiliation with Inhotim.

## Where it goes

1. **CLI MVP:** fetch → graph → route, with output as a text itinerary, GeoJSON and an HTML map.
2. **Better estimates:** elevation/slope (Tobler's hiking function), per-gallery dwell times, opening hours,
   electric carts, a lunch stop.
3. **Web app (PWA):** mobile-first map with a satellite view, offline support and a "what's new" feed. The data
   already refreshes itself daily ([ADR 0007](../history/decisions/0007-daily-data-refresh.md)).
4. **Live mode:** GPS "you are here", check off visited stops, re-route on the fly, time-left alerts before closing.
5. **Smart extras:** crowd/queue heuristics, weather-aware ordering (outdoor works while it's sunny), shareable plans.

The checklist lives in [roadmap.md](roadmap.md).

## Non-goals (for now)

- Replacing the official app, the audio guide or ticketing.
- Indoor navigation inside galleries.
- Tracking visitors. GPS is only ever used on the visitor's own device, for their own route.

## Open questions

- **Dwell times:** derive them from the number of works inside each gallery? Crowdsource them?
- **Electric carts:** worth modeling? They're paid and stop at fixed points.
- **Opening hours:** do some galleries have their own schedule? That would add time windows.
- **Accessibility:** which paths are steep, unpaved or have stairs?

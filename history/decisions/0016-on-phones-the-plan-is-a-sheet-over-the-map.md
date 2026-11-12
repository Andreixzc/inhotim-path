# 0016: On phones, the plan is a sheet dragged over a full-screen map

- **Status:** accepted
- **Date:** 2026-11-11

## Context

- On phones, the map sat on top and the plan in a sheet below it, taking up to 60% of the screen. The only way to
  hide the plan was a tap on a faint 40 × 5 px handle. Dragging did nothing.
- Andrei, on a Galaxy S22: *"i cant hide the bar where i select the things i want to see"*, and *"On mobile, i cant
  'drag' the thing to colappse it, only 'clicking' this isnt very intuitive."*
- Map apps on phones (Google Maps among them) put their panels in sheets that follow a finger, so visitors already
  know the gesture.

## Decision

- **Phones** (narrower than 900 px): the map fills the screen, and the plan is a sheet over its bottom
  (`web/js/sheet.js`).
  - The sheet follows a finger on its handle, its title or its summary. The list inside it still scrolls as before.
  - **Letting go:** if the finger is still moving, the sheet goes the way it was moving; if the finger is at rest,
    the sheet settles at the nearer end. Android's own sheets work the same way. A drag starts after 8 px
    (Android's touch slop), and the finger counts as moving at 0.2 px per ms or faster, measured over the last
    100 ms.
  - **Lowered,** it keeps the summary in view (the distance and the number of stops). The settings and the route
    can't be reached by a tap, the keyboard or a screen reader (`inert`).
  - **Taps:** a tap on the handle (or Enter or Space) lowers or raises the sheet, as before. A tap on the summary
    of a lowered sheet raises it.
- **The map under the sheet:**
  - The route stays framed in the part of the map the sheet leaves in view, clear of the credits just above it.
  - Once the visitor has moved the map, a moving sheet pans the map by half its change instead. The middle of
    their view stays in the middle of what's visible.
  - The locate button's framing and a picked stop are centered in the visible part too.
  - The map's controls and credits ride just above the sheet.
  - The map isn't resized while the sheet moves. It stays full-screen underneath, so a drag never redraws it.
- **Wide screens** keep the sidebar, and nothing moves.

## Alternatives

- **Three resting heights** (peek, half, full), as in Google Maps: more to learn and to test, for a page with one
  list. Two are enough: the plan, or the map.
- **A drawer library:** the page has no build step and no framework, and the behavior fits in about 170 lines.
- **Resizing the map with the sheet,** as before: the map would redraw on every frame of a drag.

## Consequences

- ✅ The plan can be dragged away and back, as in other map apps. When it's lowered, the route is redrawn to fill
  the bigger map.
- ✅ Checked in Chrome with real touch input at the S22's width (360 × 700). There are 22 checks: following the
  finger, slow drags, flicks both ways, taps, the language button, scrolling the list, the keyboard, a panned map,
  wide screens. All pass in light and dark mode.
- ⚠️ How it feels is a matter of taste. The thresholds live at the top of `sheet.js` (`FLICK`, `SLOP`).
- ⚠️ The route is framed 64 px above the raised sheet, so the credits (open when the page loads) don't cover it.
  That leaves the route a little less room.
- ⚠️ Not yet tried on a real phone.

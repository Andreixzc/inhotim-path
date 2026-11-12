// What a click or a tap on the map opens (ADR 0017). The park's points off the route are dots a few
// px wide, and the route's stops are markers about a fingertip wide, often side by side. So a click
// opens whatever stop or point has its edge nearest to it, within a reach: a little for a mouse,
// about a fingertip's width for a finger.
//
// Then its popup opens. Near a side of the map, MapLibre puts a popup beside the place, which on a
// phone pushes one nearly as wide as the screen off the other side. So on a narrow map a popup goes
// above or below the place, and the map moves just enough to show all of it (`placePopup`).

/** How far (px) beyond the edge of a stop or a point a click still opens it. */
export const REACH = { mouse: 8, touch: 20 };

/**
 * The reach for a click: a finger's or a mouse's. Browsers that don't say which made the click fall
 * back on the device's main pointer.
 * @param {{pointerType?: string} | undefined} event  the click
 * @param {boolean} coarse  whether the device's main pointer is a finger (`(pointer: coarse)`)
 */
export function reachFor(event, coarse) {
  const type = event?.pointerType;
  return (type ? type !== "mouse" : coarse) ? REACH.touch : REACH.mouse;
}

/**
 * Of `targets` (circles on screen), the one a click at `point` opens: the one whose edge is
 * nearest, if it's within `reach` px. Under the click, the one whose center is nearest.
 * @template {{x: number, y: number, r: number}} T
 * @param {{x: number, y: number}} point
 * @param {T[]} targets
 * @param {number} reach
 * @returns {T | null}
 */
export function nearest(point, targets, reach) {
  let best = null;
  let bestGap = Infinity;
  let bestDistance = Infinity;
  for (const target of targets) {
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    const gap = Math.max(0, distance - target.r);
    if (gap > reach || gap > bestGap || (gap === bestGap && distance >= bestDistance)) continue;
    best = target;
    bestGap = gap;
    bestDistance = distance;
  }
  return best;
}

/** Room (px) kept between a popup and the edges of what's in view. */
export const POPUP_ROOM = 12;

/**
 * Where a place's popup goes on a narrow map, and how far the map moves to show all of it: above
 * the place, or below it when there's more room there.
 * @param {{x: number, y: number}} at  the place (px on the map)
 * @param {{width: number, height: number}} size  the popup's, its tip included (px)
 * @param {{left: number, top: number, right: number, bottom: number,
 *   corner?: {left: number, bottom: number}}} view  what a popup can use (px): clear of the sheet,
 *   and on the map's buttons, which take a `corner` at the top right
 * @param {number} offset  the gap between the place and the popup's tip (px)
 * @returns {{anchor: "bottom" | "top", pan: [number, number]}}  the popup's side at the place, in
 *   MapLibre's words ("bottom": the popup is above), and the move, as the map's `panBy` takes it
 */
export function placePopup(at, size, view, offset) {
  const half = size.width / 2;
  const dx = overflow(at.x - half, at.x + half, view.left + POPUP_ROOM, view.right - POPUP_ROOM);
  // Under the map's buttons, the popup starts below them.
  const corner = view.corner && at.x - dx + half > view.corner.left - POPUP_ROOM;
  const top = (corner ? view.corner.bottom : view.top) + POPUP_ROOM;
  const bottom = view.bottom - POPUP_ROOM;
  const above = at.y - offset - top;
  const below = bottom - (at.y + offset);
  const anchor = above >= size.height || above >= below ? "bottom" : "top";
  const y = anchor === "bottom" ? at.y - offset - size.height : at.y + offset;
  return { anchor, pan: [dx, overflow(y, y + size.height, top, bottom)] };
}

/**
 * Where a place goes when the map moves to it with its popup open, and the popup's side: in the
 * middle of the view, or a little to the left if that keeps the popup clear of the map's buttons,
 * then high or low enough for all of the popup to show. Arguments as for `placePopup`.
 * @returns {{at: {x: number, y: number}, anchor: "bottom" | "top"}}
 */
export function focusPopup(size, view, offset) {
  const half = size.width / 2;
  let x = (view.left + view.right) / 2;
  if (view.corner) x = Math.min(x, view.corner.left - POPUP_ROOM - half);
  x = Math.max(x, view.left + POPUP_ROOM + half);
  const at = { x, y: (view.top + view.bottom) / 2 };
  const { anchor, pan } = placePopup(at, size, view, offset);
  return { at: { x: at.x - pan[0], y: at.y - pan[1] }, anchor };
}

/**
 * How far `low`..`high` sticks out of `min`..`max`: past `min` (< 0), or past `max`. When it's
 * longer than that, its low end shows: a popup's name and close button.
 */
function overflow(low, high, min, max) {
  return low < min ? low - min : Math.max(0, Math.min(high - max, low - min));
}

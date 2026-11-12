// What a click or a tap on the map opens (ADR 0017). The park's points off the route are dots a few
// px wide, and the route's stops are markers about a fingertip wide, often side by side. So a click
// opens whatever stop or point has its edge nearest to it, within a reach: a little for a mouse,
// about a fingertip's width for a finger.

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

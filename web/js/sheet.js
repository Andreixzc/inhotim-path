// The plan's sheet on phones (ADR 0016). It lies over the map and follows a finger: drag it down
// to see the map, with only the summary left showing, and up to get the plan back. A tap on its
// handle does the same, and so does a tap on the summary of a lowered sheet. On wider screens the
// plan is a sidebar, and this does nothing.

/** Phones and narrow windows: the same breakpoint as style.css. */
export const PHONE = "(max-width: 899px)";
/**
 * A finger still moving faster than this (px per ms) as it lets go sends the sheet the way it was
 * moving, as Android's own sheets do; one at rest leaves the sheet at the nearer end.
 */
export const FLICK = 0.2;
/** How far a finger moves (px) before a press becomes a drag: Android's touch slop. */
const SLOP = 8;
/** The finger's speed is measured over the end of the drag (ms). */
const SPEED_OVER_MS = 100;
/** A click this soon after a drag (ms) comes from the drag, not a tap. */
const CLICK_AFTER_DRAG_MS = 400;

/**
 * Whether a released sheet comes to rest lowered (only its summary showing) or raised.
 * @param {object} release
 * @param {number} release.shift  how far down the sheet is (px), from 0 (raised) to `max` (lowered)
 * @param {number} release.max
 * @param {number} release.velocity  px per ms, positive downwards
 */
export function settlesCollapsed({ shift, max, velocity }) {
  if (Math.abs(velocity) >= FLICK) return velocity > 0;
  return shift > max / 2;
}

/**
 * How fast a finger was moving as it let go (px per ms, positive downwards): how far it went over
 * the last 100 ms, or since the press for a quicker drag. So a finger that rested before letting go
 * has no speed, and the wobble of a lifting fingertip is too short to count.
 * @param {Array<[number, number]>} track  [time (ms), y (px)] of the press and the moves, in order
 * @param {number} time  when the finger let go
 * @param {number} y  where
 */
export function releaseSpeed(track, time, y) {
  let [from, fromY] = track[0];
  for (const [t, ty] of track) if (time - t >= SPEED_OVER_MS) [from, fromY] = [t, ty];
  return time > from ? (y - fromY) / (time - from) : 0;
}

export class Sheet {
  /**
   * @param {object} parts
   * @param {HTMLElement} parts.sheet
   * @param {HTMLButtonElement} parts.handle  a tap (or Enter or Space) lowers or raises the sheet
   * @param {HTMLElement[]} parts.grips  where a drag can start: the handle, the title, the summary
   * @param {HTMLElement} parts.body  what a lowered sheet hides: the settings and the route
   * @param {(sheet: Sheet) => void} parts.onSettle  called after each change, with `collapsed` and
   *   `visible` up to date
   */
  constructor({ sheet, handle, grips, body, onSettle }) {
    this.sheet = sheet;
    this.handle = handle;
    this.body = body;
    this.onSettle = onSettle;
    this.collapsed = false;
    this.shift = 0; // how far down the sheet is moved (px)
    this.drag = null;
    this.draggedAt = -Infinity;
    this.phone = matchMedia(PHONE);
    handle.addEventListener("click", () => {
      if (performance.now() - this.draggedAt > CLICK_AFTER_DRAG_MS) this.set(!this.collapsed);
    });
    for (const grip of grips) {
      grip.addEventListener("pointerdown", (event) => this.press(event));
      grip.addEventListener("pointermove", (event) => this.pull(event));
      grip.addEventListener("pointerup", (event) => this.release(event));
      grip.addEventListener("pointercancel", (event) => this.release(event));
    }
    this.phone.addEventListener("change", () => this.place());
    // New content, an alert or a rotated phone change how far down a lowered sheet goes.
    const resized = new ResizeObserver(() => this.place());
    resized.observe(sheet);
    resized.observe(body);
  }

  /** What a lowered sheet leaves on screen (px): the handle, the title and the summary. */
  get peek() {
    return this.body.offsetTop + parseFloat(getComputedStyle(this.sheet).paddingBottom);
  }

  /** How far down a lowered sheet goes (px). */
  get max() {
    return Math.max(0, this.sheet.offsetHeight - this.peek);
  }

  /** How much of the map the sheet covers (px), from the bottom; none on wide screens. */
  get visible() {
    return this.phone.matches ? Math.max(0, this.sheet.offsetHeight - this.shift) : 0;
  }

  /** Lower the sheet to its summary, or raise it. */
  set(collapsed) {
    this.collapsed = collapsed;
    this.body.inert = collapsed && this.phone.matches;
    this.move(this.rest());
    this.onSettle(this);
  }

  /** Put the sheet back where its state says: after a resize, new content or a rotation. */
  place() {
    if (this.drag?.moved) return;
    this.body.inert = this.collapsed && this.phone.matches;
    this.move(this.rest());
    this.onSettle(this);
  }

  rest() {
    return this.collapsed && this.phone.matches ? this.max : 0;
  }

  move(shift) {
    this.shift = shift;
    this.sheet.style.transform = shift > 0 ? `translateY(${shift}px)` : "";
    document.documentElement.style.setProperty("--sheet-visible", `${this.visible}px`);
  }

  press(event) {
    if (!this.phone.matches || !event.isPrimary || event.button !== 0) return;
    const control = event.target.closest("button, a, input, label, select");
    if (control && control !== this.handle) return; // the language button keeps its taps
    this.drag = {
      id: event.pointerId,
      grip: event.currentTarget,
      y: event.clientY,
      from: this.shift,
      moved: false,
      track: [[event.timeStamp, event.clientY]],
    };
  }

  pull(event) {
    const drag = this.drag;
    if (drag?.id !== event.pointerId) return;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) < SLOP) return;
      drag.moved = true;
      drag.grip.setPointerCapture(event.pointerId);
      document.body.classList.add("sheet-dragging");
    }
    const track = drag.track;
    track.push([event.timeStamp, event.clientY]);
    // The speed is measured from the last move at least 100 ms old: older ones aren't needed.
    while (track.length > 2 && event.timeStamp - track[1][0] >= SPEED_OVER_MS) track.shift();
    this.move(Math.min(Math.max(drag.from + dy, 0), this.max));
  }

  release(event) {
    const drag = this.drag;
    if (drag?.id !== event.pointerId) return;
    this.drag = null;
    if (!drag.moved) {
      // A tap on the summary of a lowered sheet raises it; the handle's taps arrive as clicks.
      const tap = event.type === "pointerup" && drag.grip !== this.handle;
      if (tap && this.collapsed) this.set(false);
      return;
    }
    document.body.classList.remove("sheet-dragging");
    this.draggedAt = performance.now();
    const velocity =
      event.type === "pointerup" ? releaseSpeed(drag.track, event.timeStamp, event.clientY) : 0;
    this.set(settlesCollapsed({ shift: this.shift, max: this.max, velocity }));
  }
}

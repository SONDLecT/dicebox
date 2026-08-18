// The scrub dial's step math, kept pure so the tests can roll it dry.
//
// A scrub is a press-drag on a value pill: every ~28px of vertical travel is
// one step, up is positive, and the value commits live as each step crosses.
// app.js owns the pointer events and the ghost rail; this module owns only
// the arithmetic that turns pixels into steps, because that is the part a
// regression would corrupt silently — an off-by-one here feels like a sticky
// dial at the table, not a thrown error.

// 28px a step: close enough to a fingertip's width that each step reads as a
// deliberate move, small enough that a phone-height drag still spans a useful
// range (~20 steps).
export const SCRUB_PX_PER_STEP = 28;

// Where a drag that started at `start` and has travelled `dyUp` pixels upward
// (negative = downward) currently points. The remainder is the fraction of a
// step left under the finger — it drives the ghost rail's translate. At the
// clamp the remainder zeroes so the rail stops dead rather than creeping
// toward a value the bounds will never deliver.
export function scrubValue(start, dyUp, min, max, pxPerStep = SCRUB_PX_PER_STEP) {
  const steps = Math.trunc(dyUp / pxPerStep);
  const value = Math.max(min, Math.min(max, start + steps));
  const clamped = value !== start + steps;
  return { value, remainder: clamped ? 0 : dyUp - steps * pxPerStep };
}

// One wheel notch, one step. Only the SIGN of deltaY is read: wheel deltas
// vary wildly by device (trackpads send pixel floods, mice send 100+ a
// notch), and scaling by magnitude made a single mouse notch jump the value
// by three. No wrap — a modifier that rolls over from +20 to −20 is a lie.
export function wheelStep(value, deltaY, min, max) {
  const dir = deltaY < 0 ? 1 : deltaY > 0 ? -1 : 0;
  return Math.max(min, Math.min(max, value + dir));
}

// The wheel on the same line the drag walks, "—" included. `unset` mirrors
// bindScrubDial's option: a notch down at min falls off into the table-judged
// null, a further notch down stays there rather than inventing a number, and
// the first notch up from null enters at `unset.enter` — the book's default
// difficulty — never at min. Without `unset` this is plain wheelStep. Kept
// here rather than in the listener so drag and wheel can be asserted
// identical dry, where a divergence fails a suite instead of confusing a
// table.
export function wheelValue(cur, deltaY, min, max, unset = null) {
  if (unset) {
    if (cur === null) return deltaY < 0 ? unset.enter : null;
    if (cur === min && deltaY > 0) return null;
  }
  return wheelStep(cur, deltaY, min, max);
}

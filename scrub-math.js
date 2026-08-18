// The scrub dial's step math, kept pure so the tests can roll it dry.
//
// A scrub is a press-drag on a value pill: every ~28px of vertical travel is
// one step, DOWN is positive, and the value commits live as each step
// crosses. Down-positive is the drum reading (the owner's ruling): the rail
// is a rotary drum facing the player with the higher values above the
// window, so dragging its surface downward rotates it toward you and brings
// those upper values down into the window. The wheel keeps its own approved
// mapping (notch up = +1) — the two gestures share a line, not a sign.
// app.js owns the pointer events and the drum rendering; this module owns
// only the arithmetic, because that is the part a regression would corrupt
// silently — an off-by-one or a flipped sign here feels like a sticky dial
// at the table, not a thrown error.

// 28px a step: close enough to a fingertip's width that each step reads as a
// deliberate move, small enough that a phone-height drag still spans a useful
// range (~20 steps).
export const SCRUB_PX_PER_STEP = 28;

// Where a drag that started at `start` and has travelled `dyDown` pixels
// downward (negative = upward) currently points. The remainder is the
// fraction of a step left under the finger — it drives the drum's live
// rotation. At the clamp the remainder zeroes so the drum stops dead rather
// than creeping toward a value the bounds will never deliver.
export function scrubValue(start, dyDown, min, max, pxPerStep = SCRUB_PX_PER_STEP) {
  const steps = Math.trunc(dyDown / pxPerStep);
  const value = Math.max(min, Math.min(max, start + steps));
  const clamped = value !== start + steps;
  return { value, remainder: clamped ? 0 : dyDown - steps * pxPerStep };
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

// ---- the drum ----
//
// The rail renders as a wireframe rotary drum seen edge-on, and this is its
// geometry: row `n` (offset from the selection window, positive above) sits
// at angle θ = (n − r)·DRUM_STEP, where `r` is the live rotation in steps —
// the drag's remainder, or the wheel's eased notch. Positive r (finger
// travelling down) turns the drum toward the viewer, carrying the upper
// values down into the window, which is what makes drag-down-increments
// read as physics rather than convention. On screen the row lands at
// translateY = −R·sin(θ) (up is negative) squashed by scaleY = cos(θ) —
// the foreshortening of a label curving away — and past the tangent
// (|θ| ≥ 90°) it is on the far side of the drum and not drawn.
export const DRUM_R = 92;      // px from axis to a label's face
export const DRUM_STEP = 0.44; // ~25° a row: ±3 rows just fill the rail
export function drumRow(n, rotationSteps = 0, R = DRUM_R, step = DRUM_STEP) {
  const theta = (n - rotationSteps) * step;
  const scale = Math.cos(theta);
  return { y: -R * Math.sin(theta), scale: Math.max(0, scale), visible: scale > 0.03 };
}

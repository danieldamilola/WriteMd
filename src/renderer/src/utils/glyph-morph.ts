/**
 * The send glyph, which morphs into a stop square while a reply is in flight.
 *
 * Two outlines with the same point count, interpolated. Both are written as
 * flat `[x, y, x, y, ...]` lists rather than path strings so the shape at any
 * point in between is a straight lerp, which is what makes the morph read as
 * one shape changing rather than two shapes swapping.
 *
 * Written from scratch, like ThoughtLine. The reference this follows is
 * react-bits' Prompt Bar, which is MIT + Commons Clause; that restriction
 * forbids redistributing the component "whether alone, in a bundle, or as a
 * ported version", and WriteMd ships as an installer. See ThoughtLine.ts for
 * the fuller note. What is borrowed is the idea, not the coordinates.
 */

/** Up arrow: head, then the stem dropping back down through the middle. */
const ARROW = [12, 3, 19, 10, 14.25, 10, 14.25, 20.5, 9.75, 20.5, 9.75, 10, 5, 10]

/** The same seven points, collapsed into a centred square. */
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 12, 18, 6, 18, 6, 12, 6, 6]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** The outline at `t`: 0 is the arrow, 1 the square. */
export function glyphPath(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  let d = ''
  for (let i = 0; i < ARROW.length; i += 2) {
    d += `${i ? 'L' : 'M'}${lerp(ARROW[i], SQUARE[i], clamped).toFixed(2)} ${lerp(
      ARROW[i + 1],
      SQUARE[i + 1],
      clamped
    ).toFixed(2)} `
  }
  return `${d}Z`
}

/**
 * Duration of the morph, in ms. Long enough to read as a deliberate change,
 * short enough not to delay a send.
 */
export const MORPH_MS = 220

/**
 * Drive the glyph from `busy` over `MORPH_MS`, calling `apply` with a 0..1
 * value on every frame. Returns a cancel function.
 *
 * A controller rather than a Lit directive for the same reason `stream-reveal`
 * is one: the output has to be committed to the DOM before it can be mutated,
 * and a directive's update runs before that. rAF rather than a CSS transition
 * because `d` is not an interpolatable property, so the browser cannot do this
 * itself.
 */
export function animateGlyph(busy: boolean, apply: (t: number) => void): () => void {
  const from = busy ? 0 : 1
  const to = busy ? 1 : 0
  const started = performance.now()
  let frame = 0
  const step = (now: number): void => {
    const k = Math.min(1, (now - started) / MORPH_MS)
    // Ease-out: the shape leaves quickly and settles, which is what a control
    // reacting to a state change should do.
    apply(from + (to - from) * (1 - (1 - k) ** 3))
    if (k < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

import { describe, it, expect } from 'vitest'
import { glyphPath, MORPH_MS } from '../src/renderer/src/utils/glyph-morph'

/**
 * The send glyph's outline at each end of its morph, and in between.
 *
 * The busy state is a stop square and the idle state an arrow. If the two
 * outlines did not share a point count the interpolation could not pair them up,
 * and the morph would silently produce a shape with one vertex too few for
 * everything after the mismatch.
 */
describe('send glyph morph', () => {
  /** Point count of a closed path, counted by its move/line commands. */
  const points = (d: string): number => (d.match(/[ML]/g) ?? []).length

  it('starts as an arrow and ends as a square', () => {
    const arrow = glyphPath(0)
    const square = glyphPath(1)
    expect(arrow).not.toBe(square)
    // The arrow's head is wide and its stem narrow; the square is neither.
    expect(arrow.startsWith('M12.00 3.00')).toBe(true)
    expect(square.startsWith('M12.00 6.00')).toBe(true)
  })

  it('keeps the same vertex count across the whole morph', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(points(glyphPath(t))).toBe(points(glyphPath(0)))
    }
  })

  it('clamps out-of-range positions to the two endpoints', () => {
    expect(glyphPath(-1)).toBe(glyphPath(0))
    expect(glyphPath(2)).toBe(glyphPath(1))
  })

  it('closes the outline', () => {
    for (const t of [0, 0.5, 1]) {
      expect(glyphPath(t).endsWith('Z')).toBe(true)
    }
  })

  it('moves monotonically from arrow to square', () => {
    // Without this the morph could overshoot and snap back, which reads as a
    // glitch rather than as a change of state.
    let previous = Infinity
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const extent = Math.max(
        ...[...glyphPath(t).matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) =>
          Math.max(Number(m[1]), Number(m[2]))
        )
      )
      // The arrow reaches further right than the square, so this shrinks.
      expect(extent).toBeLessThanOrEqual(previous)
      previous = extent
    }
    expect(previous).toBeLessThan(19)
  })

  it('is quick enough not to delay a send', () => {
    expect(MORPH_MS).toBeGreaterThan(0)
    expect(MORPH_MS).toBeLessThanOrEqual(400)
  })
})

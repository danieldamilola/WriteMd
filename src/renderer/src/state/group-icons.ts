/**
 * Group icon presets.
 *
 * Groups used to carry a colour instead, which made every row in the sidebar a
 * bright dot competing with the notes it was meant to label. An icon reads the
 * same in both tab layouts and under either colour scheme, and gives a group a
 * mark you can spot without reading the label.
 *
 * This module is data and validation only, so `file-state` can normalise a
 * persisted group without importing anything from the renderer. The render
 * helpers live beside the components that use them.
 */

export interface GroupIconPreset {
  /** Name in the shared icon set. */
  id: string
  label: string
}

/**
 * Fallback size when no stylesheet constrains the glyph. Rows actually render
 * at the shared `--icon-size`, and the picker cells shrink this to fit.
 */
export const GROUP_ICON_SIZE = 18

/**
 * Icons a user can pick for a group. `folder` stays the fallback.
 *
 * Every glyph here is distinct at 16px. `files` and `menu-folder` were the
 * obvious candidates to add and both read as a second folder in the grid, so
 * the row is table, save and bot instead: nothing in the set shares a shape
 * with anything else in it.
 */
export const GROUP_ICON_PRESETS: GroupIconPreset[] = [
  { id: 'folder', label: 'Folder' },
  { id: 'book', label: 'Book' },
  { id: 'star', label: 'Star' },
  { id: 'pin', label: 'Pin' },
  { id: 'clock', label: 'Clock' },
  { id: 'code', label: 'Code' },
  { id: 'math', label: 'Math' },
  { id: 'quote', label: 'Quote' },
  { id: 'comment', label: 'Comment' },
  { id: 'backlinks', label: 'Backlinks' },
  { id: 'globe', label: 'Globe' },
  { id: 'sparkle', label: 'Sparkle' },
  { id: 'palette', label: 'Palette' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'table', label: 'Table' },
  { id: 'save', label: 'Saved' },
  { id: 'bot', label: 'Assistant' }
]

const presetIds = new Set(GROUP_ICON_PRESETS.map(({ id }) => id))

export function isGroupIcon(id: unknown): id is string {
  return typeof id === 'string' && presetIds.has(id)
}

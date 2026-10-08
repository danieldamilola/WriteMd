const THEMES = ['dark', 'graphite', 'nord', 'midnight', 'light', 'paper', 'dracula']

/**
 * One-time shell migration; later explicit horizontal/theme choices are retained.
 *
 * Theme and accent normalization is idempotent and runs on every load: the
 * tint-era build wrote 'system' themes and empty accents that have no styles,
 * and fixing them here (rather than only on the one-shot path) repairs configs
 * that already carry `designVersion: 1`. Anything else is left alone.
 */
export function migrateDesign(source: Record<string, unknown>): Record<string, unknown> {
  const editor = source.editor
  if (editor && typeof editor === 'object' && !Array.isArray(editor)) {
    const previousEditor = editor as Record<string, unknown>
    if (
      ['Merriweather', 'Lora', 'Source Serif Pro', 'Fira Sans', 'Gochi Hand'].includes(
        String(previousEditor.fontFamily)
      )
    ) {
      source = { ...source, editor: { ...previousEditor, fontFamily: 'Manrope' } }
    }
  }
  const appearance = source.appearance
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) return source
  const { newSettingsDesign: legacyDesign, ...previous } = appearance as Record<string, unknown>
  // The classic build used '#ffffff' for monochrome; only the tint build wrote
  // an empty accent, so empty means "never chosen", not "monochrome".
  const theme =
    typeof previous.theme === 'string' && THEMES.includes(previous.theme)
      ? previous.theme
      : 'graphite'
  const accentColor =
    typeof previous.accentColor === 'string' && previous.accentColor.length > 0
      ? previous.accentColor
      : '#f24e1e'
  if (previous.designVersion === 1) {
    if (
      theme === previous.theme &&
      accentColor === previous.accentColor &&
      legacyDesign === undefined
    )
      return source
    return { ...source, appearance: { ...previous, theme, accentColor } }
  }
  return {
    ...source,
    appearance: {
      ...previous,
      designVersion: 1,
      panelOrientation: 'vertical',
      theme,
      accentColor
    }
  }
}

import { describe, it, expect } from 'vitest'
import { migrateDesign } from '../src/shared/design-migration'

describe('migrateDesign', () => {
  it('leaves a current config untouched', () => {
    const source = { appearance: { designVersion: 1, theme: 'graphite', accentColor: '#f24e1e' } }
    expect(migrateDesign(source)).toBe(source)
  })

  it('repairs tint-era values without touching anything else', () => {
    const out = migrateDesign({
      appearance: { designVersion: 1, theme: 'system', accentColor: '', railWidth: 224 }
    }) as { appearance: Record<string, unknown> }
    expect(out.appearance.theme).toBe('graphite')
    expect(out.appearance.accentColor).toBe('#f24e1e')
    expect(out.appearance.railWidth).toBe(224)
  })

  it('keeps a valid theme and a chosen monochrome accent', () => {
    const out = migrateDesign({
      appearance: { designVersion: 1, theme: 'dracula', accentColor: '#ffffff' }
    }) as { appearance: Record<string, unknown> }
    expect(out.appearance.theme).toBe('dracula')
    expect(out.appearance.accentColor).toBe('#ffffff')
  })

  it('runs the one-shot shell migration for legacy configs', () => {
    const out = migrateDesign({ appearance: { theme: 'paper', accentColor: '#00b87c' } }) as {
      appearance: Record<string, unknown>
    }
    expect(out.appearance.designVersion).toBe(1)
    expect(out.appearance.panelOrientation).toBe('vertical')
    expect(out.appearance.theme).toBe('paper')
    expect(out.appearance.accentColor).toBe('#00b87c')
    expect(out.appearance).not.toHaveProperty('newSettingsDesign')
  })

  it('ignores a missing or malformed appearance section', () => {
    expect(migrateDesign({})).toEqual({})
    const nested = { appearance: null }
    expect(migrateDesign(nested)).toBe(nested)
  })

  it('retires the beta preference and migrates removed fonts without losing other settings', () => {
    const out = migrateDesign({
      appearance: {
        designVersion: 1,
        theme: 'paper',
        accentColor: '#ffffff',
        newSettingsDesign: false
      },
      editor: { fontFamily: 'Merriweather', fontSize: 18 }
    })
    expect(out.appearance).toEqual({ designVersion: 1, theme: 'paper', accentColor: '#ffffff' })
    expect(out.editor).toEqual({ fontFamily: 'Manrope', fontSize: 18 })
    expect(migrateDesign(out)).toBe(out)
  })
})

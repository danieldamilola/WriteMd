import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({
  appearance: { theme: 'graphite', windowMaterial: 'mica' },
  nativeTheme: { themeSource: 'system' },
  release: vi.fn(() => '10.0.26200')
}))
vi.mock('electron', () => ({
  app: {},
  dialog: {},
  nativeImage: {},
  nativeTheme: mocks.nativeTheme
}))
vi.mock('os', () => ({ release: mocks.release, default: { release: mocks.release } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ appearance: mocks.appearance }) }))
import { applyWindowMaterial } from '../src/main/appearance'

describe('native window appearance', () => {
  beforeEach(() => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    mocks.appearance.theme = 'graphite'
    mocks.appearance.windowMaterial = 'mica'
    mocks.nativeTheme.themeSource = 'system'
    mocks.release.mockReturnValue('10.0.26200')
  })
  afterEach(() => vi.unstubAllGlobals())

  function windowStub(): {
    window: BrowserWindow
    setBackgroundMaterial: ReturnType<typeof vi.fn>
    setBackgroundColor: ReturnType<typeof vi.fn>
  } {
    const setBackgroundMaterial = vi.fn()
    const setBackgroundColor = vi.fn()
    return {
      window: { setBackgroundMaterial, setBackgroundColor } as unknown as BrowserWindow,
      setBackgroundMaterial,
      setBackgroundColor
    }
  }

  it.each(['dark', 'graphite', 'nord', 'midnight', 'dracula', 'light', 'paper', 'system'])(
    'matches native appearance to the %s theme',
    (theme) => {
      mocks.appearance.theme = theme
      applyWindowMaterial(windowStub().window)
      expect(mocks.nativeTheme.themeSource).toBe(
        theme === 'system' ? 'system' : ['light', 'paper'].includes(theme) ? 'light' : 'dark'
      )
    }
  )

  it.each(['mica', 'acrylic'])('applies %s with a transparent window background', (material) => {
    mocks.appearance.windowMaterial = material
    const stub = windowStub()
    applyWindowMaterial(stub.window)
    expect(stub.setBackgroundMaterial).toHaveBeenCalledWith(material)
    expect(stub.setBackgroundColor).toHaveBeenCalledWith('#00000000')
  })

  it('falls back to a solid window when materials are unsupported', () => {
    mocks.release.mockReturnValue('10.0.22000')
    const stub = windowStub()
    applyWindowMaterial(stub.window)
    expect(stub.setBackgroundMaterial).toHaveBeenCalledWith('none')
    expect(stub.setBackgroundColor).toHaveBeenCalledWith('#000000')
  })
})

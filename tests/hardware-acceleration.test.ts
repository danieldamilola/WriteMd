import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ enabled: true, disable: vi.fn() }))
vi.mock('electron', () => ({ app: { disableHardwareAcceleration: state.disable } }))
vi.mock('../src/main/settings', () => ({
  getSettings: () => ({ advanced: { hardwareAcceleration: state.enabled } })
}))
import {
  configureHardwareAcceleration,
  getHardwareAccelerationSetting
} from '../src/main/hardware-acceleration'

describe('hardware acceleration at startup', () => {
  beforeEach(() => state.disable.mockClear())

  it('uses Electron defaults when enabled', () => {
    state.enabled = true
    configureHardwareAcceleration()
    expect(state.disable).not.toHaveBeenCalled()
    expect(getHardwareAccelerationSetting()).toBe(true)
  })

  it('disables acceleration and keeps the launch choice separate from a pending change', () => {
    state.enabled = false
    configureHardwareAcceleration()
    expect(state.disable).toHaveBeenCalledOnce()
    state.enabled = true
    expect(getHardwareAccelerationSetting()).toBe(false)
  })
})

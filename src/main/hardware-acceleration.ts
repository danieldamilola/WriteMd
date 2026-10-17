import { app } from 'electron'
import { getSettings } from './settings'

let startupSetting = true

/** Must run before app.whenReady(), while Electron still accepts this choice. */
export function configureHardwareAcceleration(): void {
  startupSetting = getSettings().advanced.hardwareAcceleration
  if (!startupSetting) app.disableHardwareAcceleration()
}

/** The saved choice used for this launch, rather than a pending preference. */
export function getHardwareAccelerationSetting(): boolean {
  return startupSetting
}

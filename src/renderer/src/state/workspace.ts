import { SettingsStore } from './settings'

export interface PaneGeometry {
  width: number
  min: number
  max: number
  compact: boolean
}

export function paneGeometry(
  available: number,
  preferred: number,
  firstMin = 320,
  secondMin = 320,
  gutter = 5
): PaneGeometry {
  const usable = Math.max(0, available - gutter)
  const compact = usable < firstMin + secondMin
  const max = Math.max(0, usable - secondMin)
  return {
    width: compact ? available : Math.min(max, Math.max(firstMin, preferred)),
    min: compact ? 0 : firstMin,
    max: compact ? available : max,
    compact
  }
}

/** Persist user intent; window constraints only affect derived geometry. */
export class WorkspaceState {
  private static instance: WorkspaceState
  private settings = SettingsStore.getInstance()
  static getInstance(): WorkspaceState {
    return (this.instance ??= new WorkspaceState())
  }
  get paneWidth(): number {
    return this.settings.get('appearance.paneWidth', 600)
  }
  get railWidth(): number {
    return this.settings.get('appearance.railWidth', 208)
  }
  resizePane(width: number): void {
    this.settings.set('appearance.paneWidth', Math.round(width))
  }
  resizeRail(width: number): void {
    this.settings.set('appearance.railWidth', Math.round(width))
  }
}

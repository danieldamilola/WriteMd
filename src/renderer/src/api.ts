/**
 * The renderer reaches the main process only through this.
 *
 * There were twelve hand-rolled copies of `function api()` across the renderer,
 * each re-deriving what `getAPI()` in `shared/electron-api.ts` already does.
 * One accessor means one place where the bridge is looked up, and one place to
 * stub in a test.
 */
import { getAPI, type ElectronAPI } from '../../shared/electron-api'

export function api(): ElectronAPI | undefined {
  return getAPI()
}

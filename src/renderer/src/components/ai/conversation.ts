import { api } from '../../api'
import { TurnController } from './turn-controller'

let bridge: NonNullable<ReturnType<typeof api>>['ai'] | undefined
let shared: TurnController | undefined
let views = 0

/** Both AI surfaces use the same session, transcript, and live request. */
export function conversationController(): TurnController {
  const currentBridge = api()?.ai
  if (!shared || currentBridge !== bridge) {
    shared?.dispose()
    shared = new TurnController()
    bridge = currentBridge
    views = 0
  }
  return shared
}

export function connectConversation(controller: TurnController): void {
  if (controller !== shared) return
  views++
  controller.connect()
}

export function disconnectConversation(controller: TurnController): void {
  if (controller !== shared) return
  views = Math.max(0, views - 1)
  // Let the other surface mount during a switch before canceling a live turn.
  setTimeout(() => {
    if (controller === shared && views === 0) controller.dispose()
  }, 0)
}

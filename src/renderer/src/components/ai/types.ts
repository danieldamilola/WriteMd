import { api } from '../../api'
import type {
  AiEvent,
  AiSendInput,
  ChangeView,
  PersistedSessionView,
  SkippedView,
  UndoStatus
} from '../../../../shared/electron-api'

/**
 * The AI bridge contract.
 *
 * Re-exported from `shared/electron-api.ts` rather than declared here. This
 * started as a local copy because the turn half of `ElectronAPI['ai']` had not
 * been declared yet - and a copy is exactly how the two halves end up
 * disagreeing about whether `status` is a string or a union, which is the class
 * of bug that shows up as a silently-wrong undo message rather than a type
 * error. `shared/` is the one place both sides can reach.
 */
export type { AiEvent, AiSendInput, ChangeView, SkippedView, UndoStatus }

/** A file the user attached to one message. Images carry base64, text the text. */
export interface AiAttachment {
  name: string
  kind: 'image' | 'text'
  /** Base64 payload, no data: prefix. Images only. */
  data?: string
  /** `image/png` and friends. Images only. */
  mimeType?: string
  /** File contents. Text only. */
  text?: string
}

/** What undo did. `changed-since` is a refusal, not a failure. */
export interface UndoOutcomeView {
  status: UndoStatus
  path?: string
  entryId?: string
}

/**
 * A saved conversation, without its messages.
 *
 * A narrower view of `PersistedSessionView` for the history list, which never
 * needs the transcript and should not have to hold twelve of them in memory.
 */
export type SessionView = Pick<PersistedSessionView, 'id' | 'title' | 'createdAt' | 'updatedAt'>

/** The turn half of the bridge, as this panel calls it. */
export interface AiBridge {
  send(requestId: string, input: AiSendInput): Promise<unknown>
  cancel(requestId: string): Promise<void>
  onEvent(cb: (e: AiEvent) => void): () => void
  listChanges(sessionId?: string): Promise<ChangeView[]>
  undoChange(journalId: string): Promise<UndoOutcomeView>
  listSessions(): Promise<PersistedSessionView[]>
  saveSession(session: SessionView): Promise<void>
  deleteSession(id: string): Promise<void>
}

/**
 * The AI slice of the bridge, or undefined when there is no bridge.
 *
 * A cast, because the renderer may be running against an older preload where
 * `ai` has only the settings calls. Every call still goes through optional
 * chaining, so that degrades to "the assistant is unavailable" rather than
 * throwing on load.
 */
export function aiBridge(): AiBridge | undefined {
  return api()?.ai as unknown as AiBridge | undefined
}

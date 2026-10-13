/**
 * One turn of conversation, in the shape the session file already uses.
 *
 * The floating bar and the chat panel are two views of the same conversation,
 * so this is the only thing that has to travel between them.
 */
export interface HandoffMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiHandoff {
  sessionId?: string
  /** The bar's transcript, oldest first. */
  messages: HandoffMessage[]
  /** The note the bar was captured against, for the panel's context chip. */
  path: string | null
  /**
   * The selection the bar was scoped to, if any.
   *
   * Carried so a question the user asked about a highlighted phrase can be
   * followed up about the same phrase. The panel reads a live selection from
   * the DOM, and by the time it opens the bar has taken focus and the text
   * selection is gone - so without this the follow-up loses its subject and the
   * whole note is sent instead.
   */
  selection: string | null
}

/**
 * A conversation waiting to be picked up by the panel.
 *
 * Module state rather than an event: the bar and the panel are siblings that are
 * never mounted at the same time - opening one closes the other - so there is no
 * common live component to carry a payload between them. The panel is mounted
 * *after* the bar is torn down, so a bus event fired on close would arrive with
 * nobody listening.
 */
let pending: AiHandoff | null = null

/** Hand a conversation to the next panel that opens. */
export function stageAiHandoff(handoff: AiHandoff): void {
  pending = handoff
}

/**
 * Take the staged conversation, if there is one.
 *
 * Read-once: the panel clears it after taking it, so closing and reopening the
 * panel does not resurrect a conversation the user has moved on from.
 */
export function takeAiHandoff(): AiHandoff | null {
  const handoff = pending
  pending = null
  return handoff
}

/** True when a panel opening right now would find a conversation waiting. */
export function hasAiHandoff(): boolean {
  return pending !== null
}

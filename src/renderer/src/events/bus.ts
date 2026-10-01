/**
 * Typed app-level event bus.
 *
 * Two signals used to travel as untyped `window` CustomEvents:
 * `writemd-find` (open the find panel) and `writemd-open-wikilink` (follow a
 * `[[wiki link]]`). Nothing tied a dispatch to its handler, neither had a
 * teardown story beyond remembering the exact listener reference, and a typo in
 * an event name was silently a no-op at runtime.
 *
 * These are app-level signals, not DOM events: they cross component boundaries
 * where there is no parent-child relationship, which is exactly what a bus is
 * for. Component-scoped events (`close`, `select`, `find-next`) stay as
 * `CustomEvent`s because Lit templates already bind and unbind those.
 */

export interface AppEvents {
  /** Open the find/replace panel. */
  'find:open': { mode: 'find' | 'replace' }
  /** Follow a `[[wiki link]]` by its label. */
  'wiki:open': { name: string }
}

type Handler<K extends keyof AppEvents> = (detail: AppEvents[K]) => void

const handlers = new Map<string, Set<Handler<never>>>()

/** Subscribe. The returned function unsubscribes. */
export function on<K extends keyof AppEvents>(type: K, handler: Handler<K>): () => void {
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  const entry = handler as Handler<never>
  set.add(entry)
  return () => {
    set?.delete(entry)
    if (set && set.size === 0) handlers.delete(type)
  }
}

/** Publish. A handler that throws must not stop the others from running. */
export function emit<K extends keyof AppEvents>(type: K, detail: AppEvents[K]): void {
  const set = handlers.get(type)
  if (!set) return
  for (const handler of [...set]) {
    try {
      ;(handler as Handler<K>)(detail)
    } catch (err) {
      console.error(`Handler for "${String(type)}" threw:`, err)
    }
  }
}

/** Test seam: drop every subscription. */
export function resetBus(): void {
  handlers.clear()
}

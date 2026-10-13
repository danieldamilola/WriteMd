import { sameFilePath } from '../../utils/paths'
import type { QuickAiReference } from './references'
import type { PreviewChangeView } from './types'

export type { QuickAiReference }

export interface QuickAiSelection {
  from: number
  to: number
  text: string
}

/** Frozen editor text and selection captured when the quick panel opens. */
export interface QuickAiContext {
  path: string | null
  content: string
  selection: QuickAiSelection | null
  /**
   * Notes the user pulled in with `@`, read at send time.
   *
   * Resolved by a callback rather than read here: the bar is a component with no
   * vault of its own, and this is the only place in the file that would need
   * one. Returning a promise keeps the bar's send path synchronous up to the
   * point the request starts.
   */
  collectReferences?: (text: string) => Promise<QuickAiReference[]>
  /** Paths of open tabs, so the model knows what is already on screen. */
  openPaths?: string[]
}

/** Apply only a proposal that still targets the exact text captured for review. */
export function quickAiReplacement(
  context: QuickAiContext,
  change: PreviewChangeView
): string | null {
  if (!context.path || !sameFilePath(change.path, context.path)) return null
  if (context.selection) {
    const { from, to, text } = context.selection
    if (
      from < 0 ||
      to < from ||
      to > context.content.length ||
      context.content.slice(from, to) !== text ||
      change.original !== text
    )
      return null
    return context.content.slice(0, from) + change.content + context.content.slice(to)
  }
  if (change.original !== context.content) return null
  return change.content
}

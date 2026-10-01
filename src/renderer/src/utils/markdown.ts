/**
 * One markdown-it configuration for the renderer.
 *
 * There were three, and they had drifted apart:
 * - `TableWidget`: `breaks: false`
 * - `AiPanel`: `breaks: true`
 * - `main/export.ts`: `typographer: true`, `breaks: false`
 *
 * `AiPanel` and `TableWidget` differ only in the `breaks` flag, which is a
 * behavior fork rather than a deliberate difference: the same markdown rendered
 * two different ways depending on which component asked. `html: false` is the
 * load-bearing option in all of them, since every consumer feeds the result to
 * `innerHTML` or `unsafeHTML`. It is asserted in `tests/inline-markdown.test.ts`
 * so a future flag change cannot quietly open an XSS hole.
 */
import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from 'markdown-it'

export interface MarkdownOptions {
  /**
   * Treat a single newline as a line break. Matches how people write in a chat
   * box, which is where `AiPanel` needs it; wrong for documents.
   */
  breaks?: boolean
  /** Replace straight quotes and dashes with typographic characters. */
  typographer?: boolean
}

/** Build a configured instance. `html` is always off. */
export function createMarkdownIt(options: MarkdownOptions = {}): MarkdownItInstance {
  return new MarkdownIt({
    html: false,
    linkify: true,
    breaks: options.breaks ?? false,
    typographer: options.typographer ?? false
  })
}

/** Chat-style rendering: single newlines break. */
export function createChatMarkdownIt(): MarkdownItInstance {
  return createMarkdownIt({ breaks: true })
}

/** Document-style rendering. */
export function createDocumentMarkdownIt(options: MarkdownOptions = {}): MarkdownItInstance {
  return createMarkdownIt({ breaks: false, ...options })
}

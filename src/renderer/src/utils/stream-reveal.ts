/**
 * Word-by-word reveal for answers arriving token by token.
 *
 * Pattern from transitions.dev (`detail?t=streaming-text`): each word sits in a
 * span that resolves from `opacity: 0` + `blur()` to fully visible, one word at
 * a time. Unlike the reference this never replays - a revealed word stays
 * revealed - because the text here is genuinely arriving, and restarting the
 * effect on every token would re-animate the whole answer each time.
 *
 * This is a controller rather than a Lit directive on purpose. A directive's
 * `update` runs before its output is committed, so there is no DOM to walk yet;
 * and wrapping the answer in its own custom element would put a shadow root
 * between it and the panel's markdown styles. The caller calls `sync` after
 * each render, from its own `updated`.
 *
 * The CSS lives with the component that renders this: the spans are created
 * inside whichever shadow root the text lands in, and a stylesheet from another
 * root cannot reach them.
 */

import { reducedMotionNow } from './motion'

/** One word per tick, matching the reference's `--stream-gap`. */
const GAP_MS = 60

/**
 * How deep the backlog is allowed to get. Past this the reveal releases several
 * words per tick, so a 900-word answer takes about as long to appear as it took
 * to arrive instead of the 54 seconds a flat 60ms would spend on it.
 */
const BACKLOG_TARGET = 10

const WORD_CLASS = 'stream-w'
const REVEALED_CLASS = 'is-in'

export interface StreamReveal {
  /** Wrap the container's words and keep revealing them. */
  sync(container: Element | null): void
  /** Stop the timer and forget the reveal. */
  reset(): void
}

/**
 * The staged reveal is motion, so it follows the app's motion preference
 * rather than the media query alone: someone who asked Windows for less motion
 * can still ask WriteMd for the full effect, and someone who wants none gets
 * the message immediately.
 */
function prefersReducedMotion(): boolean {
  return reducedMotionNow()
}

/**
 * Wrap every text run inside the container in a word span.
 *
 * Idempotent, which it has to be: the panel calls `sync` from `updated`, and
 * `updated` runs on every render, not only when the text changed. A text node
 * already sitting inside a word span is left alone, so re-running this cannot
 * nest a second span inside the first. Without that guard the span count
 * roughly doubles per render and the renderer hangs.
 */
function wrapWords(container: Element): void {
  // Gather first, replace second: a TreeWalker over a tree being mutated
  // beneath it skips and re-reads nodes.
  const texts: Text[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text)

  for (const node of texts) {
    const owner = node.parentElement
    if (!owner) continue
    if (owner.closest(`.${WORD_CLASS}`)) continue
    const frag = document.createDocumentFragment()
    for (const chunk of node.data.split(/(\s+)/)) {
      if (!chunk) continue
      // Whitespace stays bare so line breaks and inline spacing still wrap.
      if (!/\S/.test(chunk)) {
        frag.appendChild(document.createTextNode(chunk))
        continue
      }
      const span = document.createElement('span')
      span.className = WORD_CLASS
      span.textContent = chunk
      frag.appendChild(span)
    }
    owner.replaceChild(frag, node)
  }
}

export function createStreamReveal(): StreamReveal {
  /** How many words are showing. Also the index of the next one to reveal. */
  let revealed = 0
  let timer: number | null = null
  let words: HTMLElement[] = []

  const stop = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const reset = (): void => {
    stop()
    words = []
    revealed = 0
  }

  const schedule = (): void => {
    if (revealed >= words.length) {
      stop()
      return
    }
    if (prefersReducedMotion()) {
      // Nothing to stagger: the message is simply there the moment it exists.
      for (const w of words) w.classList.add(REVEALED_CLASS)
      revealed = words.length
      stop()
      return
    }
    if (timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      const pending = words.length - revealed
      const budget = Math.max(1, Math.ceil(pending / BACKLOG_TARGET))
      for (let i = 0; i < budget && revealed < words.length; i++) {
        words[revealed]?.classList.add(REVEALED_CLASS)
        revealed++
      }
      schedule()
    }, GAP_MS)
  }

  return {
    sync(container: Element | null): void {
      if (!container) {
        reset()
        return
      }
      wrapWords(container)
      words = Array.from(container.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`))
      // A shorter list than before means the content was replaced or truncated.
      revealed = Math.min(revealed, words.length)
      // Words already shown keep their state; the word at the cursor is the only
      // one left hidden, so it has a painted hidden state to transition from.
      for (let i = 0; i < revealed; i++) words[i]?.classList.add(REVEALED_CLASS)
      schedule()
    },
    reset
  }
}

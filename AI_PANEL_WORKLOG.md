# AI Panel Work Log

Changelog for the AI assistant panel and its supporting infrastructure. Not the
release notes — this is the running record of what changed and why, in the same
voice.

Scope note: this covers only work on the AI panel, its provider layer, and the
tooling needed to test them. Icon-set, tab-strip, settings-contract and link
work from earlier in the cycle are covered separately.

---

## Streaming Answers

- **Answers Now Arrive Token by Token.** The panel used to wait for the provider
  to finish and then render the whole reply in one go, so a slow model looked
  identical to a hung one. Requests now set `stream: true` and every delta is
  forwarded to the renderer as it arrives. `src/main/sse.ts` holds the
  incremental frame parser; `ipc.ts` owns the reader and pushes deltas down the
  existing bridge. The renderer appends each delta to a placeholder message,
  which is what the reveal animation follows.
- **Every Provider Gets a Streaming Shape.** OpenAI-compatible providers (OpenAI,
  Groq, Mistral, DeepSeek, xAI, OpenRouter, Ollama) take `stream: true` in the
  body. Gemini switches to `:streamGenerateContent?alt=sse`, without which the
  endpoint returns one comma-joined body rather than events. Anthropic reads
  `content_block_delta` / `text_delta` frames and ignores its `ping` and
  `message_start` traffic. Adapters that cannot stream return `null` from
  `buildStreamRequest` and the caller falls back to the one-shot path, so a
  provider that does not support it degrades instead of failing.
- **A Mid-Stream Error Is Still an Error.** Some gateways answer `200` and then
  put an error object in a normal frame. Treating that as an empty delta would
  have dropped the failure silently, so `extractStreamChunk` throws on it.
- **The Partial Reply Survives a Failure.** If a stream dies halfway, the text
  that already arrived is kept and the error is reported underneath it, rather
  than replacing real output with an error message.
- **`streaming` Is Not Persisted.** The settle handler writes the session while a
  reply is still arriving, so the flag is stripped before the transcript is
  saved. Without that, reopening a chat replayed the reveal animation.

## Word-by-Word Reveal

- **Text Resolves Rather Than Appearing.** Each word sits in a span that goes
  from `opacity: 0` plus a 1px blur to fully visible, one word at a time on a
  60ms cadence, resolving over 350ms on a decelerating curve. Pattern taken from
  transitions.dev (`detail?t=streaming-text`) and written from scratch — the
  reference is a ~400-line Alpine component with an unclear licence, and the
  effect is four CSS rules and a timer.
- **It Never Replays.** The reference wipes every word and re-animates on demand.
  Here the text is genuinely arriving, so doing that on every token would
  re-animate the whole answer each time. Revealed words stay revealed.
- **A Backlog Does Not Stall the Reveal.** A flat 60ms would take 54 seconds to
  show a 900-word answer. Past ten words waiting, several are released per tick,
  so a long reply takes about as long to appear as it took to arrive.
- **It Is a Controller, Not a Directive.** A Lit directive's `update` runs before
  its output is committed, so there is no DOM to walk yet, and wrapping the
  answer in its own custom element would put a shadow root between it and the
  panel's markdown styles. The panel calls `sync` from its own `updated` instead.
- **`prefers-reduced-motion` Shows Everything At Once.** Nothing staggers, no
  blur, no transition.

## Prompt Composer

- **The Input Grows With What You Type.** The old control was a one-line `<input>`
  at a fixed height. It is now a textarea that starts at one line and grows to
  six, capped so a pasted document cannot take over the panel, and scrolls
  beyond that. `resize` is off: the box follows its content rather than the other
  way round.
- **Enter Sends, Shift+Enter Does Not.** A prompt is frequently multi-line — a
  diff, a list, a block of markdown — and there was no way to write one.
- **The Composer Locks During a Request.** A second send would interleave two
  transcripts in the same session.
- **An Open IME Candidate Is Not a Send.** Enter confirms a candidate, so
  submitting on it would send half-typed pinyin.
- **The Send Control Follows the Draft.** It is disabled on an empty or
  whitespace-only prompt, and sends on click as well as on Enter.
- **The Model Is Named Below the Box.** Which model will answer was previously
  visible only in Settings, one layer away from the thing that decides it.

## Thought Line

- **The Elapsed Time Is What Earns Its Place.** A working→settled status line
  replaces the plain italic "Thinking…" bubble. It counts while the model works
  and keeps the number afterwards, so a slow reply stays legible in the
  transcript.
- **It Is Static by Design.** The first version breathed the glyph, swept a
  highlight across the label and crossfaded into the settled sentence. In a panel
  the user is trying to read, that was animation for its own sake. Everything was
  removed; the labels swap with no transition and the inactive one is out of
  layout entirely.
- **Written From Scratch, Not Ported.** react-bits' Thought Line is MIT + Commons
  Clause, whose restriction forbids redistributing the component "whether alone,
  in a bundle, or as a ported version". WriteMd is MIT and ships as an installer,
  so a copy would be a redistribution. The same problem ruled out icons8's free
  tier earlier in the cycle.
- **The Settled Line Is Kept in the Transcript.** Otherwise the elapsed time
  exists only while the bubble is mounted and vanishes the moment the reply
  lands.

## Chat Log Spacing

- **The Settled Line Hugs the Answer Below It.** The log's row gap dropped from
  12px to 8px, and the elapsed-time line takes a small negative top margin so it
  reads as an annotation on the reply rather than as a separate message.

## Bug Fixes

- **The Transcript Grew Without Bound.** The thought line emitted its settle
  event on mount as well as on a real transition. A line restored from a saved
  transcript mounts already settled, so it reported itself, the owner appended
  another entry, that entry rendered another line, and the session save looped
  until the renderer died. Symptom in the field was a panel filled with repeated
  `Thinking Thought for 0.0s` lines and a stream of `chat:save` failures. Settle
  now reports only a genuine `true → false` transition.
- **A Settled Line Started Counting.** A persisted entry was bound with the
  boolean-attribute form, which leaves the reflected attribute absent, so the
  property kept its `true` default and the restored line began ticking from zero.
- **The Panel Mounted Mid-Settle.** Lit reports the class-default assignment of
  `loading` as a change from `undefined`, which the panel was reading as "work
  just finished". A panel opened with nothing in flight came up in the settle
  state with a settled live line mounted. It now only holds when `loading` was
  actually `true`.
- **Word Spans Nested On Every Render.** The reveal re-wrapped text nodes already
  inside a word span each time it ran, and it ran on every render, so the span
  count roughly doubled per pass. Wrapping is now idempotent.
- **Concurrent Session Saves Raced.** The settle handler and the submit handler
  both persist, and they can overlap. Two renames onto one destination do not
  queue: on Windows the loser failed with `EPERM` because the target was
  momentarily open, leaving the transcript as whichever write happened to win.
  Writes are now serialised per session id.
- **Answers From Reasoning Models Came Back Empty.** OpenRouter's Nemotron and
  DeepSeek R1 and OpenAI's o-series can return `content: null` with the text in a
  `reasoning` field, which produced "missing `choices[0].message.content`" for a
  correctly working key. Some gateways return `content` as an array of typed
  parts, and the field can be an empty string when a reply was cut off — all
  three are handled, and a genuine no-answer is reported with the finish reason
  to hand.

## Tooling and Tests

- **`tests/ai-stream.test.ts`** — 22 tests over the frame parser and the
  streaming adapters: frames split across chunk boundaries mid-JSON, CRLF
  endings, comment and keep-alive lines, the `[DONE]` terminator, non-JSON
  payloads, a trailing frame with no blank line, `event:`/`id:` fields, Gemini's
  SSE endpoint, Anthropic's non-text frames, a mid-stream error object, and a
  whole answer reassembled from a realistic OpenAI wire.
- **`tests/thought-line.test.ts`** — 7 tests over the settle contract: silent on
  mount when already settled, silent across re-renders, reporting once per
  working cycle (not on the flip back), elapsed time rendered rather than
  counted, and the clock freezing on settle.
- **`tests/ai-panel.test.ts`** — 24 tests over the composer and the reveal under
  jsdom: send behaviour including IME and whitespace, the draft-driven send
  control, the model hint, the unconfigured state, span idempotence across
  re-renders, the transcript not growing when a settled entry mounts, and the
  reveal draining a long backlog.
- **`tests/e2e/ai-panel.spec.ts`** — 5 specs driving the real app. The provider is
  a fake Ollama on `127.0.0.1:11434` speaking real SSE, which is the URL the
  adapter already points at for Ollama, so the composer, `net:chat-stream`, the
  parser, the adapter, the streaming message and the reveal are all exercised
  with no API key and no network. The bridge itself cannot be stubbed from the
  page — `contextBridge` hands the renderer a proxy, and assigning to one of its
  properties silently does nothing — so a server on the port the adapter already
  uses is the seam that holds.
- **Suite totals:** 342 unit tests across 33 files, 15 e2e. `pnpm typecheck` and
  `pnpm lint` clean.

## Status

All of the above is in the working tree and uncommitted. `pnpm typecheck`,
`pnpm lint`, `pnpm test` and `pnpm test:e2e` were green as of the last full run.

Also outstanding and unrelated to this work: `RELEASE_NOTES_v1.2.0.md` and two
screenshots are still uncommitted from earlier in the cycle, and the notes no
longer describe the panel accurately given the streaming work above.

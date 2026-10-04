# Stress Test Report

What the app does when the vault is not small, measured rather than guessed.

## How to reproduce

```
node tests/stress/generate-vault.mjs      # writes ~/Documents/WriteMd Vault/_stress
npx vitest run tests/stress/perf.test.ts  # micro-benchmarks against those files
npx playwright test tests/e2e/stress.spec.ts
```

Fixtures live in the real vault under `_stress/` and nowhere else. They are
deterministic, regenerated from scratch each run, and safe to delete.

| Fixture | What it is |
| --- | --- |
| `huge-single.md` | 6 MB, 8000 sections, mixed markdown |
| `huge-table.md` | 4000 rows x 8 columns (32 000 cells) |
| `long-lines.md` | 4 MB as 20 lines of 200 000 characters |
| `many-diagrams.md` | 60 Mermaid blocks |
| `wiki-links.md` | 3000 `[[wiki]]` and markdown links |
| `unicode.md` | emoji, ZWJ, CJK, RTL, combining marks, lone surrogates |
| `deep-nesting.md` | 40 nested lists, 30 nested quotes, long emphasis runs |
| `features-*.md` | one file per parser extension (math, tasks, code, footnotes, callouts, frontmatter, images) |
| `many/` | 1500 notes across 20 folders |

## What the profiler said

Before any change, a CPU profile of 19 keystrokes in `huge-single.md` looked
like this:

| Self time | Where |
| --- | --- |
| 30.9% | `InfoPill.countStats` (word count) |
| 11.1% | garbage collector |
| 25% | Lezer markdown parser |
| 12.6% | `getMathDecorations` + `getWikiLinkDecorations` + `getFrontmatterDecorations` |

The word count ran `text.trim().split(/\s+/)` on every render, and the pill
re-renders on every keystroke: 350ms and a million-element array per character
typed. The three decoration plugins each stringified the whole document per
transaction. The inline-preview plugin walked the entire syntax tree from the
root on every update and asked Lezer for the whole document with a 200ms
budget. The editor's own state subscriber serialized the document a second time
just to discover the view was already in sync.

## Changes

- **Word count in one pass**, allocation-free, debounced 250ms
  (`InfoPill.countStats`). Identical results to the old split, pinned by
  `tests/info-pill-count.test.ts`.
- **Viewport-scoped decoration scans.** Wiki links scan the viewport plus a 2 KB
  margin; frontmatter scans the first 64 KB (that is where frontmatter lives);
  live preview iterates only the visible range and asks Lezer only for it, with
  the parse budget cut to 25ms past 1 MB so a keystroke cannot turn into a
  guaranteed stall.
- **Math delimiters cached and rescanned from the edit.** The scan is the
  expensive part and moving the cursor does not change a single delimiter, so
  matches are cached per document; a keystroke rescans from the first changed
  offset (with a 20 KB margin so a pair straddling the boundary is re-found)
  rather than the whole file. It has to stay a `StateField`, because block
  replacements are rejected from plugins (`Block decorations may not be
  specified via plugins`), which the stress run caught the hard way: the editor
  came up empty on every document with `$$`.
- **Tables patch instead of rebuild.** CodeMirror replaces a block widget on
  every keystroke inside it, and the table rebuilt all 32 000 cells every time.
  `updateDOM` now redraws only the row that changed.
- **No second serialization.** The editor keeps the exact string the view
  produced and compares against that instead of calling `doc.toString()` again.
- **Mermaid loads on first diagram**, not at startup, so its layout engines
  (dagre, cytoscape, elk) are out of memory for notes without diagrams.
- **Backlinks read with bounded concurrency** (24 in flight) instead of firing
  an IPC call per note in the vault at once.
- **Session restore** builds the tab list once instead of copying the array per
  tab, and no longer awaits the file watcher serially.

## Results

Same machine, same fixtures, before and after:

| Scenario | Before | After |
| --- | --- | --- |
| Open 6 MB note | 1154 ms | 436 ms |
| Open 4 MB of 200k-char lines | 9607 ms | 2911 ms |
| Open 4000-row table | 4690 ms | 1802 ms |
| Render the whole 1500-file tree | did not finish (click loop timed out) | 3121 ms, no long task |
| Type 19 chars in a 6 MB note | 9803 ms, worst task 427 ms | 4448 ms, worst task 281 ms |
| Type 8 chars in a 4000-row table | worst task 1143 ms | worst task 601 ms |
| Backlink scan over 1500 notes | not measured | 970 ms |
| 60 Mermaid diagrams | not measured | 2450 ms, no long task |
| Type 19 chars, CPU samples | 14261 | 2927 |
| Word count share of typing CPU | 30.9% | 3.5% |
| Whole-document string copies per keystroke | 4 | 1 |
| Working set at rest | 757 MB | 570 MB |
| Restore a 40-tab session | not measured | 1894 ms |

Micro-benchmarks (`tests/stress/perf.test.ts`) on a 6 MB note:

| Operation | Time |
| --- | --- |
| `doc.toString()` | 21 ms |
| Lezer markdown parse | 2590 ms |
| markdown-it render (export) | 2310 ms |
| math delimiter scan | 9 ms |
| save-echo check | 5 ms |
| word count, old way | 349 ms |
| word count, new way | ~10 ms |

## Where the time goes now

A CPU profile of 19 keystrokes in a 6 MB note, with the whole 1559-row vault
tree mounted in the split pane, attributes the work like this:

| Share | What |
| --- | --- |
| ~45% | Lezer's markdown parser and tree walk (`parse`, `parseInline`, `finishLeaf`, `addActions`, `nextChild`) |
| ~14% | browser layout and paint |
| ~6% | garbage collection |
| ~3.5% | the word count |
| rest | CodeMirror view, DOM, input plumbing |

The app's own share is now single-digit percent. Everything left is inside
CodeMirror and Lezer, which is the price of markdown parsing a 6 MB document.

## Known limits

Not fixed, with the numbers so they can be compared later:

- **4000-row tables** still cost about 1.2s to open, because opening builds all
  32 000 cells once. Per keystroke it is now cheap; the first paint is not.
- **200 000-character lines** cost about 2.7s to parse, all inside Lezer's inline
  parser. Nothing in the app is quadratic here.
- **Find** walks every match to count them: 860ms worst task with 14 000
  matches in a 6 MB note.
- **The vault tree renders every row** with no windowing. 1500 files is fine;
  tens of thousands would need it.
- **Math delimiters bigger than the 20 KB rescan margin** lose their widget until
  the next edit.
- **Export** was measured only through `markdown-it`: 2.3s to render a 6 MB note
  to HTML before the docx and PDF stages, which are not covered here.
- **The AI panel** was exercised only by the existing e2e spec, not under load.

## Harness

- `tests/e2e/stress.spec.ts` - 14 scenarios against the real vault: open cost
  per fixture shape, typing, clicking, scrolling, find, Mermaid, KaTeX and
  footnotes, command palette, backlink scan, full tree render, 40-tab typing,
  40-tab session restore. Measures wall clock, long tasks (via
  `PerformanceObserver`), and native working set from the main process. Writes
  `test-results/stress-metrics.json`.
- `tests/stress/perf.test.ts` - 10 micro-benchmarks with budgets. Skips itself
  when the fixtures are absent, so a fresh clone still passes.
- `tests/stress/generate-vault.mjs` - the fixture generator. `--quick` for small
  sizes, `--vault <dir>` to point elsewhere.
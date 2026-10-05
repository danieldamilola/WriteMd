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

| Fixture            | What it is                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `huge-single.md`   | 6 MB, 8000 sections, mixed markdown                                                         |
| `huge-table.md`    | 4000 rows x 8 columns (32 000 cells)                                                        |
| `long-lines.md`    | 4 MB as 20 lines of 200 000 characters                                                      |
| `many-diagrams.md` | 60 Mermaid blocks                                                                           |
| `wiki-links.md`    | 3000 `[[wiki]]` and markdown links                                                          |
| `unicode.md`       | emoji, ZWJ, CJK, RTL, combining marks, lone surrogates                                      |
| `deep-nesting.md`  | 40 nested lists, 30 nested quotes, long emphasis runs                                       |
| `features-*.md`    | one file per parser extension (math, tasks, code, footnotes, callouts, frontmatter, images) |
| `many/`            | 1500 notes across 20 folders, plus one folder holding 600                                   |

## What the profiler said

Before any change, a CPU profile of 19 keystrokes in `huge-single.md` looked
like this:

| Self time | Where                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| 30.9%     | `InfoPill.countStats` (word count)                                            |
| 11.1%     | garbage collector                                                             |
| 25%       | Lezer markdown parser                                                         |
| 12.6%     | `getMathDecorations` + `getWikiLinkDecorations` + `getFrontmatterDecorations` |

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
- **Table cells skip the parser when there is nothing to parse.** Every cell
  went through markdown-it even when it was plain words, which was the bulk of
  the first paint. Cells without an inline-markdown character render as escaped
  text.
- **A 4000-row table shows 400 rows and says how many are hidden.** No amount of
  cleverness makes 32 000 cells cheap to build; the footer states the count and
  points at source mode, which still has every row.
- **Find counts to a cap.** Counting walked every match; it now stops at 5000
  and reports `N of 5000+` rather than a wrong total.
- **The AI panel stops sending whole files.** The open document was embedded in
  every question, so a 6 MB note meant a 6 MB payload that no provider accepts.
  The context is capped at 200 000 characters, the model is told the file was
  cut, and the cut never lands inside a surrogate pair.
- **PDF and DOCX export refuse documents over 4 MB** with a message naming the
  alternative. Both run in one blocking pass on the main process at roughly
  6 seconds per megabyte, so a large note looked like a hung app. HTML export is
  not capped.
- **A folder with more than 300 notes summarizes.** One row says how many are
  hidden and expands on click, instead of a DOM row per note.
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

| Scenario                                   | Before                                | After                       |
| ------------------------------------------ | ------------------------------------- | --------------------------- |
| Open 6 MB note                             | 1154 ms                               | 630 ms                      |
| Open 4 MB of 200k-char lines               | 9607 ms                               | 2755 ms                     |
| Open 4000-row table                        | 4690 ms, worst task 3550 ms           | 496 ms, worst task 321 ms   |
| Click inside a 4000-row table              | did not return                        | 94 ms                       |
| Type 8 chars in a 4000-row table           | worst task 1143 ms                    | worst task 206 ms           |
| Render the whole 1500-file tree            | did not finish (click loop timed out) | 3630 ms, no long task       |
| Expand a 600-note folder                   | 600 rows of DOM                       | 1 summary row, 57 ms        |
| Type 19 chars in a 6 MB note               | 9803 ms, worst task 427 ms            | 5196 ms, worst task 364 ms  |
| Find in a 6 MB note, 14 000 matches        | worst task 860 ms                     | worst task 534 ms           |
| Follow a wiki link                         | did nothing                           | 529 ms                      |
| Toggle a task in a 500-task note           | no coverage                           | 161 ms                      |
| Auto-save a 6 MB note, no false conflict   | not measured                          | 8770 ms, worst task 1048 ms |
| Switch theme on a 6 MB note                | not measured                          | 1437 ms, worst task 86 ms   |
| Type 19 chars, CPU samples                 | 14261                                 | 2927                        |
| Word count share of typing CPU             | 30.9%                                 | 3.5%                        |
| Whole-document string copies per keystroke | 4                                     | 1                           |
| Working set at rest                        | 757 MB                                | 566 MB                      |
| Restore a 40-tab session                   | not measured                          | 2016 ms                     |
| Backlink scan over 1500 notes              | not measured                          | 985 ms                      |
| 60 Mermaid diagrams                        | not measured                          | 2434 ms, no long task       |

Micro-benchmarks (`tests/stress/perf.test.ts`) on a 6 MB note, machine otherwise
idle:

| Operation                   | Time    |
| --------------------------- | ------- |
| `doc.toString()`            | 7 ms    |
| Lezer markdown parse        | 749 ms  |
| markdown-it render (export) | 672 ms  |
| html-to-docx, 1 MB of HTML  | 5884 ms |
| math delimiter scan         | 4 ms    |
| save-echo check             | 2 ms    |
| word count, old way         | 115 ms  |
| word count, new way         | ~5 ms   |

## What the stress run found that was not performance

- **Wiki links could not be clicked in live preview.** The widget returned
  `ignoreEvent() === false`, so CodeMirror handled the mousedown and put the
  cursor on the link's line. That made the line "active", which drops the very
  decoration holding the widget in favour of the raw `[[text]]`, and the click
  landed on a node that no longer existed. Following a wiki link did nothing,
  silently, in every live-preview document. `ignoreEvent` now claims mousedown
  and click, the way the task checkbox already did.
- **Links and checkboxes had no e2e coverage at all**, which is why the above
  survived. `docs/phases.md` lists "E2E coverage for links and backlinks" as
  outstanding; wiki-link following and task toggling are now covered.

## Where the time goes now

A CPU profile of 19 keystrokes in a 6 MB note, with the whole 1559-row vault
tree mounted in the split pane, attributes the work like this:

| Share | What                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------- |
| ~45%  | Lezer's markdown parser and tree walk (`parse`, `parseInline`, `finishLeaf`, `addActions`, `nextChild`) |
| ~14%  | browser layout and paint                                                                                |
| ~6%   | garbage collection                                                                                      |
| ~3.5% | the word count                                                                                          |
| rest  | CodeMirror view, DOM, input plumbing                                                                    |

The app's own share is now single-digit percent. Everything left is inside
CodeMirror and Lezer, which is the price of markdown parsing a 6 MB document.

## Known limits

Not fixed, with the numbers so they can be compared later:

- **200 000-character lines** cost about 2.5s to parse, all inside Lezer's
  inline parser. Nothing in the app is quadratic here, and the only fix would be
  a different parser.
- **A 6 MB note still takes 2.6s of Lezer parse** the first time it is opened
  far from the cursor, and roughly 250ms of main-thread work per keystroke after
  that. Bounded, not removed.
- **Tables over 400 rows show a truncation notice** rather than virtualizing.
  Row virtualization is the real answer and would need the widget to know the
  viewport; CodeMirror only calls `updateDOM` when it replaces a widget.
- **A folder over 300 notes needs one click to show the rest.** Windowing the
  tree would remove the click and cost a scroll-position implementation.
- **Math delimiter pairs larger than the 200 KB rescan margin** lose their
  widget until the next edit.
- **Export is capped at 4 MB for PDF and DOCX.** Documents above that need HTML,
  which is fast but not paginated.
- **The AI panel** is bounded by the context cap, not stress-tested against a
  real provider: the existing e2e spec mocks the transport.

## Harness

- `tests/e2e/stress.spec.ts` - 21 scenarios against the real vault: open cost
  per fixture shape, typing, clicking, scrolling, find, Mermaid, KaTeX and
  footnotes, command palette, backlink scan, full tree render, a 600-note
  folder, reading mode, following a wiki link, toggling a task, switching theme,
  auto-save without a false conflict, the word count, 40-tab typing, 40-tab
  session restore. Measures wall clock, long tasks (via `PerformanceObserver`),
  and native working set from the main process. Writes
  `test-results/stress-metrics.json`.
- `tests/stress/perf.test.ts` - 11 micro-benchmarks with budgets. Skips itself
  when the fixtures are absent, so a fresh clone still passes.
- `tests/stress/size-guards.test.ts` - pins every cap and guard added here, so a
  later change cannot quietly remove one.
- `tests/stress/generate-vault.mjs` - the fixture generator. `--quick` for small
  sizes, `--vault <dir>` to point elsewhere.

Measurements were taken with another WriteMd instance open on the same machine,
which is why the run-to-run spread on the pathological fixtures is wide. The
numbers above are from one representative run, not the best of several.

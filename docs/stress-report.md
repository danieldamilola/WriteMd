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
- **Math delimiters cached.** The scan is the expensive part and moving the
  cursor does not change a single delimiter, so matches are cached per document
  and rescanned only when the document changes. It has to stay a `StateField`,
  because block replacements are rejected from plugins
  (`Block decorations may not be specified via plugins`), which the stress run
  caught the hard way: the editor came up empty on every document with `$$`.
- **No second serialization.** The editor keeps the exact string the view
  produced and compares against that instead of calling `doc.toString()` again.
- **Mermaid loads on first diagram**, not at startup, so its layout engines
  (dagre, cytoscape, elk) are out of memory for notes without diagrams.
- **Session restore** builds the tab list once instead of copying the array per
  tab, and no longer awaits the file watcher serially.

## Results

Same machine, same fixtures, before and after:

| Scenario | Before | After |
| --- | --- | --- |
| Open 6 MB note | 1154 ms | 341 ms |
| Open 4 MB of 200k-char lines | 9607 ms | 3245 ms |
| Open 4000-row table | 4690 ms | 1784 ms |
| Render the whole 1500-file tree | did not finish (click loop timed out) | 4638 ms, worst task 80 ms |
| Type 19 chars in a 6 MB note | 9803 ms, worst task 427 ms | 4564 ms, worst task 281 ms |
| Type in 6 MB note, CPU samples | 14261 | 3645 |
| Word count share of typing CPU | 30.9% | 2.7% |
| Working set at rest | 757 MB | 443 MB |
| Restore a 40-tab session | tabs missing, slow | 2040 ms |

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

## Known limits

Not fixed, with the numbers so they can be compared later:

- **4000-row tables** still cost about 1.2s on open or click. The table is one
  block widget, so editing state changes rebuild all 32 000 cells. Real notes
  have tens of rows; the fix is to stop rebuilding on editability changes.
- **200 000-character lines** cost about 3s to parse, all inside Lezer's inline
  parser. Nothing in the app is quadratic here.
- **Find** walks every match to count them: 853ms worst task with 14 026
  matches in a 6 MB note.
- **The vault tree renders every row** with no windowing. 1500 files is fine;
  tens of thousands would need it.
- **Math delimiter rescans** still cost about 13ms per keystroke on a 6 MB note.
  Making it incremental from the changed offset is the next step.

## Harness

- `tests/e2e/stress.spec.ts` - 9 scenarios against the real vault: open cost per
  fixture shape, typing, clicking, scrolling, find, full tree render, 40-tab
  typing, 40-tab session restore. Measures wall clock, long tasks (via
  `PerformanceObserver`), and native working set from the main process. Writes
  `test-results/stress-metrics.json`.
- `tests/stress/perf.test.ts` - 10 micro-benchmarks with budgets. Skips itself
  when the fixtures are absent, so a fresh clone still passes.
- `tests/stress/generate-vault.mjs` - the fixture generator. `--quick` for small
  sizes, `--vault <dir>` to point elsewhere.
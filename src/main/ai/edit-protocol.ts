import { dirname, isAbsolute, join } from 'path'

/**
 * The edit protocol.
 *
 * The model is asked to emit fenced SEARCH/REPLACE blocks rather than call
 * tools. That choice is doing a lot of work:
 *
 * - No tool schema to hallucinate. A model asked to call `edit_file` can call
 *   `editFile`, or invent a third one; a block is a block.
 * - Deterministic. Every change is a literal string replacement, so the result
 *   is exactly what the model wrote or nothing at all. There is no interpreter
 *   between the model and the bytes.
 * - It composes with the editor. Each block names a file and a region, which
 *   maps directly onto a diff per file.
 *
 * Blocks carry a `path`, which is the only difference from a single-file
 * version: the header is `<<<<<<< SEARCH path="notes/idea.md"` and each file's
 * blocks are applied against that file.
 *
 * The one rule that is not optional under auto-apply: if any block for a file
 * fails to match, that file is not written. A model whose SEARCH text was
 * slightly off produces a document missing that change; writing it anyway looks
 * like the edit succeeded. Better a file the user knows was skipped.
 */

export interface EditBlock {
  /** Path exactly as the model wrote it. Resolved later, never trusted. */
  path: string
  search: string
  replace: string
  /** Replace a supplied snapshot without asking the model to echo it. */
  wholeFile?: boolean
}

export interface ParsedEdits {
  blocks: EditBlock[]
  /** Prose the model wrote outside the blocks. */
  explanation: string
  hasEdits: boolean
  incomplete?: boolean
}

const HEADER_RE = /^<{7}[ \t]*SEARCH(?:[ \t]+path=(?:"([^"]*)"|'([^']*)'|(\S+)))?[ \t]*$/
const REWRITE_HEADER_RE = /^<{7}[ \t]*REWRITE(?:[ \t]+path=(?:"([^"]*)"|'([^']*)'|(\S+)))?[ \t]*$/
const SEPARATOR_RE = /^={7}[ \t]*$/
const TERMINATOR_RE = /^>{7}[ \t]*REPLACE[ \t]*$/

/**
 * Parse SEARCH/REPLACE blocks out of a model response.
 *
 * Line-based rather than one big regex, and that is a deliberate reversal.
 *
 * A single regex over this grammar needs the newline before each delimiter to
 * be optional, because a section is allowed to be empty - an empty REPLACE
 * deletes a range, an empty SEARCH creates a file. Expressing "consume the
 * newline if there is one" inside a regex means a lookahead, and a zero-width
 * lookahead does not move the position the next `^` is tested against. Both
 * attempts at that produced a pattern that either dropped every deletion or
 * stopped matching anything at all, and both failures are silent: no edit
 * applied, no error, an assistant that looks broken rather than a parser that
 * looks wrong.
 *
 * Scanning lines has no such trap. The delimiters are lines in their own right,
 * everything between them is content, and an empty section is simply the empty
 * list between two adjacent delimiters.
 */
export function parseEdits(response: string, defaultPath: string): ParsedEdits {
  const lines = response.split(/\r?\n/)
  const blocks: EditBlock[] = []
  const prose: string[] = []
  let incomplete = false

  for (let i = 0; i < lines.length; i++) {
    const rewrite = REWRITE_HEADER_RE.exec(lines[i])
    const header = rewrite ?? HEADER_RE.exec(lines[i])
    if (!header) {
      prose.push(lines[i])
      continue
    }

    // Collect the search body up to the separator line.
    const search: string[] = []
    while (!rewrite && i + 1 < lines.length && !SEPARATOR_RE.test(lines[i + 1])) {
      search.push(lines[++i])
    }
    if (!rewrite && i + 1 >= lines.length) {
      // No separator: the model was cut off mid-block. Keep what was written so
      // far as prose rather than inventing a block with no replacement.
      prose.push(lines[i])
      incomplete = true
      break
    }
    if (!rewrite) i++ // step past the separator

    // Collect the replacement up to the terminator line.
    const replace: string[] = []
    while (i + 1 < lines.length && !TERMINATOR_RE.test(lines[i + 1])) {
      replace.push(lines[++i])
    }
    if (i + 1 >= lines.length) {
      prose.push(lines[i])
      incomplete = true
      break
    }
    i++ // step past the terminator

    const path = (header[1] ?? header[2] ?? header[3] ?? '').trim() || defaultPath
    blocks.push({
      path,
      search: search.join('\n'),
      replace: replace.join('\n'),
      ...(rewrite ? { wholeFile: true } : {})
    })
  }

  return {
    blocks,
    explanation: prose.join('\n').trim(),
    hasEdits: blocks.length > 0,
    ...(incomplete ? { incomplete: true } : {})
  }
}

export interface BlockFailure {
  block: EditBlock
  reason: 'not-found' | 'ambiguous'
  /** Where it matched, for the ambiguity case. Character offset. */
  at?: number
  occurrences?: number
}

export interface FileProposal {
  /** Canonical absolute path. */
  path: string
  /** Path as the model wrote it, for messages. */
  requestedPath: string
  /** Original content. */
  before: string
  /** Content after every block applied. */
  after: string
  blocks: EditBlock[]
  /** Blocks that could not be applied. Non-empty means do not write. */
  failures: BlockFailure[]
  /** True when the file does not exist yet and the blocks create it. */
  isCreation: boolean
}

/**
 * How many times `needle` occurs in `haystack`.
 *
 * The empty case is not a curiosity. `String.indexOf` with an empty needle
 * clamps to the string length rather than reporting no match, so `''.indexOf('',
 * 1)` is `0`, not `-1`, and the obvious loop never terminates. An empty SEARCH
 * is how a model creates a file, so this is reachable from ordinary output and
 * hung the whole process.
 *
 * An empty needle also matches at every position, which is `length + 1` places.
 * For a non-empty document that makes the match ambiguous by definition, which
 * is the honest answer: an empty SEARCH on a file with content cannot mean one
 * specific region.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return haystack.length + 1
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    // Resume one past the hit so overlapping occurrences still count; a blank
    // line inside a search is a legitimate way to match a region.
    index = haystack.indexOf(needle, index + 1)
  }
  return count
}

export interface ApplyResult {
  proposals: FileProposal[]
  explanation: string
  hasEdits: boolean
  /** Files with at least one block that did not apply. Left unwritten. */
  skippedPaths: string[]
}

/**
 * Apply parsed blocks to a set of files.
 *
 * `contents` maps canonical path to the file's current content, or undefined
 * for a file that does not exist. Grouping by path first means each file is
 * transformed independently and a failure in one cannot corrupt another.
 */
export function applyEdits(
  parsed: ParsedEdits,
  contents: ReadonlyMap<string, { content: string; exists: boolean }>,
  resolvePath: (requested: string) => string | null,
  snapshots: ReadonlyMap<string, string> = new Map()
): ApplyResult {
  const byPath = new Map<string, { requested: string; blocks: EditBlock[] }>()
  for (const block of parsed.blocks) {
    const canonical = resolvePath(block.path)
    if (!canonical) continue
    const entry = byPath.get(canonical)
    if (entry) entry.blocks.push(block)
    else byPath.set(canonical, { requested: block.path, blocks: [block] })
  }

  const proposals: FileProposal[] = []
  for (const [path, entry] of byPath) {
    const source = contents.get(path)
    const before = source?.content ?? ''
    const failures: BlockFailure[] = []
    let working = before

    // Sequential, against the already-modified text. A block's SEARCH may rely
    // on an earlier block having landed, which is how multi-step rewrites are
    // expressed without a separate instruction.
    for (const block of entry.blocks) {
      if (block.wholeFile) {
        // Only replace text the model actually received. Never overwrite a
        // document that changed during generation or an unseen file.
        const snapshot = snapshots.get(path)
        if (snapshot === undefined || working !== snapshot) {
          failures.push({ block, reason: 'not-found' })
        } else {
          working = block.replace
        }
        continue
      }
      const index = working.indexOf(block.search)
      if (index === -1) {
        failures.push({ block, reason: 'not-found' })
        continue
      }
      const occurrences = countOccurrences(working, block.search)
      if (occurrences > 1) {
        // Guessing which one the model meant is how a rewrite silently lands in
        // the wrong place. Report it; the file does not get written anyway
        // because this counts as a failure.
        failures.push({ block, reason: 'ambiguous', at: index, occurrences })
        continue
      }
      working = working.slice(0, index) + block.replace + working.slice(index + block.search.length)
    }

    proposals.push({
      path,
      requestedPath: entry.requested,
      before,
      after: working,
      blocks: entry.blocks,
      failures,
      isCreation: source?.exists === false
    })
  }

  return {
    proposals,
    explanation: parsed.explanation,
    hasEdits: parsed.hasEdits,
    skippedPaths: proposals.filter((p) => p.failures.length > 0).map((p) => p.path)
  }
}

/** Build the system prompt that teaches the protocol. */
export function editSystemPrompt(defaultPathLabel: string): string {
  return (
    'You are the assistant inside WriteMd, a Markdown editor.\n\n' +
    'Decide what the user wants:\n' +
    '- If they ask a QUESTION, answer concisely in Markdown. Do NOT output edit blocks.\n' +
    '- If they ask you to CHANGE a file, respond with edit blocks ONLY. You may put at most one short sentence of summary before the blocks.\n\n' +
    '- Writing or drafting an article, post, or other content is a request to edit the open document. Put the content in edit blocks, not in the chat reply. An empty document is still an editable file.\n\n' +
    'Edit block format - one per change, EXACTLY:\n' +
    '<<<<<<< SEARCH' +
    (defaultPathLabel ? ` path="${defaultPathLabel}"` : '') +
    '\n' +
    '(text to find, copied verbatim from the file including whitespace; minimal but unique)\n' +
    '=======\n' +
    '(replacement text)\n' +
    '>>>>>>> REPLACE\n\n' +
    'Rules:\n' +
    '- SEARCH must match the file character-for-character.\n' +
    '- Omit the path header only when editing the file the user is in.\n' +
    '- Use a path header for every other file. One block header per file.\n' +
    '- Markdown files may be outside the vault. Use their supplied absolute paths and edit only files the user asks you to change.\n' +
    '- SEARCH text must appear exactly once. If it appears twice, the change is not applied.\n' +
    '- For a paragraph, sentence, backlink, or other local change, use the smallest unique SEARCH and replace only that region. Never copy the entire document for a local edit.\n' +
    '- To INSERT, SEARCH a nearby existing line and repeat it unchanged in REPLACE with the new text added around it.\n' +
    '- To APPEND, SEARCH only the final unique line or paragraph and repeat it in REPLACE followed by the addition.\n' +
    "- To DELETE a line, end SEARCH with that line's trailing newline, or the line leaves a blank one behind.\n" +
    '- When the user asks to rewrite, reorganize, or replace the entire document, use this format instead of SEARCH/REPLACE:\n<<<<<<< REWRITE\n(the complete rewritten document)\n>>>>>>> REPLACE\n' +
    '- REWRITE accepts the same optional path header. It replaces the supplied snapshot directly. Do not output the old document, a separator, or an appended second copy. Use it only for a document whose full contents were supplied.\n' +
    '- For an empty document, leave SEARCH empty and put the entire draft in REPLACE. Do not add placeholder text to SEARCH. Example:\n<<<<<<< SEARCH\n=======\n(draft)\n>>>>>>> REPLACE\n' +
    "- Preserve the user's Markdown style, heading levels, and voice.\n" +
    '- Never wrap blocks in ``` fences. Output nothing after the final block.'
  )
}

/** Turn a model-written path into an absolute one, or null if unusable. */
export function resolveRequestedPath(requested: string, base: string): string | null {
  const trimmed = requested.trim()
  if (!trimmed || trimmed.includes('\0')) return null
  const absolute = isAbsolute(trimmed) ? trimmed : join(base, trimmed)
  return dirname(absolute) ? absolute : null
}

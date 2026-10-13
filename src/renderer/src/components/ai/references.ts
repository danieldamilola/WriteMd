import { api } from '../../api'
import { normalizePathExact } from '../../utils/links'

/**
 * What the user pulled into a request with `@`.
 *
 * One resolver, shared. The floating bar and the chat panel both need it, and
 * two copies would drift: the panel's copy skips a leading `/name` because that
 * is a skill, and a second implementation that did not would send a skill's
 * name to the model as though it were a file. That distinction is the whole
 * point of the mention syntax.
 */
export interface QuickAiReference {
  path: string
  content: string
}

/** Bounded, because a prompt naming twenty files would send twenty documents. */
const MAX_REFERENCES = 6

/**
 * Read the notes a prompt names, so "compare these two" means something to the
 * model instead of arriving as two bare paths.
 *
 * `@name` is always a file. A leading `/name` is a skill and is skipped here,
 * because a skill has no contents to send: the main process resolves it and
 * folds its instructions into the system prompt instead. The rule is positional
 * on purpose - a leading slash is how a skill is invoked, and a slash later in
 * a sentence is a path.
 */
export async function collectReferences(userText: string): Promise<QuickAiReference[]> {
  const named = new Set<string>()
  for (const match of userText.matchAll(/(?:^|\s)[@/](?:"([^"]+)"|([^\s@]+))/g)) {
    // A leading bare /name selects a personal skill, which is not a file.
    if (
      !userText.slice(0, match.index).trim() &&
      /^\/[a-z][a-z0-9-]{0,63}$/.test(match[0].trim())
    ) {
      continue
    }
    const relative = (match[1] ?? match[2]).replace(/\\/g, '/')
    if (
      relative.startsWith('/') ||
      relative.split('/').includes('..') ||
      /^[a-z]:/i.test(relative)
    ) {
      continue
    }
    named.add(relative)
    if (named.size >= MAX_REFERENCES) break
  }
  if (!named.size) return []
  let base = ''
  try {
    base = (await api()?.vault?.getPath?.()) ?? ''
  } catch (err) {
    console.error('Could not read the vault path:', err)
  }
  const root = base.replace(/[\\/]+$/, '')
  if (!root) return []
  const out: QuickAiReference[] = []
  for (const relative of named) {
    try {
      const result = await api()?.file?.read?.(normalizePathExact(`${root}/${relative}`))
      if (!result) continue
      out.push({ path: relative, content: result.content })
    } catch (err) {
      console.error(`Could not read the referenced file ${relative}:`, err)
    }
  }
  return out
}

import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'fs'
import { dirname, isAbsolute, join, relative } from 'path'
import type { AiSkillsView, AiSkillView } from '../../shared/ai/skills'

const MAX_SKILL_BYTES = 256 * 1024
const MAX_SKILLS = 64
const SKILL_NAME = /^[a-z][a-z0-9-]{0,63}$/

interface LoadedSkill extends AiSkillView {
  instructions: string
}

interface SkillCandidate {
  path: string
  label: string
  name: string
  directory: boolean
}

function commandName(value: string): string | undefined {
  let name = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!name) return undefined
  if (!/^[a-z]/.test(name)) name = `skill-${name}`
  name = name.slice(0, 64).replace(/-+$/g, '')
  return SKILL_NAME.test(name) ? name : undefined
}

function frontmatterValue(text: string, key: string): string | undefined {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  if (!block) return undefined
  const value = block.match(
    new RegExp(`^${key}:\\s*(?:"([^"\\r\\n]+)"|'([^'\\r\\n]+)'|([^#\\r\\n]+))`, 'm')
  )
  return (value?.[1] ?? value?.[2] ?? value?.[3])?.trim()
}

export function skillsFolder(vault: string): string {
  return join(vault, 'Skills')
}

function locations(vault: string): string[] {
  return [skillsFolder(vault), join(vault, '.writemd', 'skills')]
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function inside(path: string, root: string): boolean {
  const part = relative(root, path)
  return (
    part !== '..' &&
    !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(part)
  )
}

function checkDirectory(path: string, root: string): void {
  if (
    !lstatSync(path).isDirectory() ||
    lstatSync(path).isSymbolicLink() ||
    !inside(realpathSync(path), root)
  ) {
    throw new Error('The skills folder must be a local folder inside your vault.')
  }
}

/**
 * The Unslop skill, shipped with the app.
 *
 * WriteMd's house style is a file in the user's vault rather than a string in
 * the binary, for three reasons: they can read it, edit it, and delete it. It
 * appears as a slash command like any other skill, so `/unslop` still works for
 * a request that is about style rather than about content.
 *
 * Never overwritten. A user who has edited this file made it theirs, and a file
 * that rewrites itself on every launch cannot be edited at all.
 */
const UNSLOP_FILENAME = 'Unslop.md'

const UNSLOP = `---
name: unslop
description: Cut filler, hedging, throat-clearing and generic conclusions from a reply.
---

# Unslop

Apply these to every reply. They are house style, not suggestions.

**Cut**
- Filler and padding: "I'd be happy to", "Great question", "It's worth noting", "As an AI", "I hope this helps".
- Throat-clearing: announcing that you are about to answer, then answering.
- Restating the question before answering it.
- Summarising what you just said, at the end, because a reply feels too short without it.
- Generic conclusions: "In conclusion", "Ultimately", "Overall", a closing paragraph that adds no information.
- Hedging that costs the reader nothing: "It could be argued that", "It is important to note that".
- Performed enthusiasm and apology for the state of your own output.

**Keep**
- The answer, first, before anything else.
- Specifics: names, numbers, dates, paths, the actual wording the user asked about.
- The user's own vocabulary, including informal words and technical terms they chose.
- Structure that carries weight: a heading, a list or a code block where it genuinely helps, and nowhere else.
- Uncertainty where it is real, stated once, plainly.

**Never**
- Invent a source, statistic, quote or completed action.
- Pad an explanation with an example that adds nothing.
- Answer a question the user did not ask because it seemed related.

Do not mention these rules. Apply them silently.
`

/** The visible skills folder is created with the vault, seeded with Unslop. */
export function ensureSkillsFolder(vault: string): string {
  const root = realpathSync(vault)
  const folder = skillsFolder(vault)
  mkdirSync(folder, { recursive: true })
  checkDirectory(folder, root)
  seedUnslop(folder)
  return folder
}

/** Write the shipped skill if it is not already there. Never overwrites. */
function seedUnslop(folder: string): void {
  const path = join(folder, UNSLOP_FILENAME)
  try {
    // Exists already, so it is the user's now.
    lstatSync(path)
    return
  } catch (error) {
    if (!missing(error)) throw error
  }
  writeFileSync(path, UNSLOP, { encoding: 'utf8', flag: 'wx' })
}

function readSkillFile(path: string, name: string, root: string): LoadedSkill {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || !inside(realpathSync(path), root)) {
    throw new Error('SKILL.md must be a regular file inside the skills folder.')
  }
  // Read a bounded buffer rather than trusting a size checked before opening.
  const fd = openSync(path, 'r')
  let instructions: string
  try {
    const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    if (size > MAX_SKILL_BYTES) throw new Error('Skill instructions must be 256 KB or smaller.')
    instructions = buffer.subarray(0, size).toString('utf8').trim()
  } finally {
    closeSync(fd)
  }
  if (!instructions) throw new Error('SKILL.md is empty.')
  const description =
    instructions.match(/^description:\s*([^\r\n]+)/m)?.[1]?.replace(/^["']|["']$/g, '') ??
    instructions.match(/^#+\s+([^\r\n]+)/m)?.[1] ??
    name
  const canonical = commandName(frontmatterValue(instructions, 'name') ?? '') ?? name
  return { name: canonical, description: description.slice(0, 240), instructions }
}

function checkSkillsLocation(vault: string, folder: string): void {
  const root = realpathSync(vault)
  if (folder !== skillsFolder(vault)) checkDirectory(dirname(folder), root)
  checkDirectory(folder, root)
}

function candidates(folder: string): SkillCandidate[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() ||
        entry.isSymbolicLink() ||
        (entry.isFile() && /\.md$/i.test(entry.name))
    )
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
    )
    .flatMap((entry) => {
      const directory =
        entry.isDirectory() || (entry.isSymbolicLink() && !/\.md$/i.test(entry.name))
      const name = commandName(directory ? entry.name : entry.name.replace(/\.md$/i, ''))
      return name ? [{ path: join(folder, entry.name), label: entry.name, name, directory }] : []
    })
}

function readCandidate(folder: string, entry: SkillCandidate): LoadedSkill {
  const root = realpathSync(folder)
  if (entry.directory) {
    checkDirectory(entry.path, root)
    const file = readdirSync(entry.path)
      .sort()
      .find((name) => name.toLowerCase() === 'skill.md')
    return readSkillFile(join(entry.path, file ?? 'SKILL.md'), entry.name, root)
  }
  return readSkillFile(entry.path, entry.name, root)
}

function scanSkills(vault: string): AiSkillsView & { loaded: LoadedSkill[] } {
  const folder = skillsFolder(vault)
  const result: AiSkillsView & { loaded: LoadedSkill[] } = {
    folder,
    skills: [],
    warnings: [],
    loaded: []
  }
  for (const location of locations(vault)) {
    try {
      checkSkillsLocation(vault, location)
      const entries = candidates(location)
      for (const entry of entries) {
        if (result.skills.length >= MAX_SKILLS) break
        try {
          const skill = readCandidate(location, entry)
          if (result.skills.some((loaded) => loaded.name === skill.name)) continue
          result.loaded.push(skill)
          result.skills.push({ name: skill.name, description: skill.description })
        } catch (error) {
          result.warnings.push(
            `${entry.label}: ${error instanceof Error ? error.message : 'Could not read skill.'}`
          )
        }
      }
      if (entries.length > MAX_SKILLS)
        result.warnings.push(
          'Only the first 64 skills are listed. You can still use a skill by name.'
        )
    } catch (error) {
      if (!missing(error)) {
        result.warnings.push(error instanceof Error ? error.message : 'Could not read skills.')
      }
    }
  }
  result.skills.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

export function listSkills(vault: string): AiSkillsView {
  const view: AiSkillsView = { ...scanSkills(vault) }
  delete (view as Partial<{ loaded: unknown }>).loaded
  return view
}

/** Instructions are read fresh and included only for an explicit leading /name. */
export function requestedSkill(vault: string, userText: string): LoadedSkill | undefined {
  const name = userText.match(/^\s*\/([a-z][a-z0-9-]{0,63})(?=\s|$)/)?.[1]
  if (!name) return undefined
  for (const folder of locations(vault)) {
    try {
      checkSkillsLocation(vault, folder)
      for (const entry of candidates(folder)) {
        try {
          const skill = readCandidate(folder, entry)
          if (skill.name === name) return skill
        } catch {
          // Invalid candidates never shadow a readable skill with the same command.
        }
      }
    } catch (error) {
      if (!missing(error)) break
    }
  }
  throw new Error(`Skill /${name} was not found or could not be read. Check Skills in AI Settings.`)
}

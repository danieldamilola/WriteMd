import { describe, it, expect, afterEach } from 'vitest'
import { collectReferences } from '../src/renderer/src/components/ai/references'
import { requestedSkill, listSkills } from '../src/main/ai/skills'
import { assistantInstructions } from '../src/main/ai/instructions'
import { cleanupTempRoot, makeTempRoot } from './helpers/temp-root'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * The two kinds of mention.
 *
 * `@note` is a file with contents. `/skill` is a set of instructions with none.
 * The model was being handed the second and asked to treat it as the first, so
 * it would try to summarise a style guide or claim to have edited it.
 */

type Api = NonNullable<Window['electronAPI']>

function stubVault(files: Record<string, string>): void {
  const root = 'C:/vault'
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    vault: { getPath: async () => root },
    file: {
      read: async (path: string) => {
        const relative = path.replace(/\\/g, '/').replace(`${root}/`, '')
        const content = files[relative]
        if (content === undefined) throw new Error('ENOENT')
        return { content, path }
      }
    }
  } as unknown as Api
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('the two kinds of mention', () => {
  it('keeps the ending of large references and reads subsequent mentions', async () => {
    const large = 'x'.repeat(125_596) + 'REFERENCE_END'
    stubVault({ 'large.md': large, 'next.md': 'NEXT_REFERENCE' })
    expect(await collectReferences('Compare @large.md and @next.md')).toEqual([
      { path: 'large.md', content: large },
      { path: 'next.md', content: 'NEXT_REFERENCE' }
    ])
  })
  it('reads an @ note and leaves a leading / skill alone', async () => {
    stubVault({ 'notes/idea.md': 'IDEA_BODY', 'unslop.md': 'NOT_A_NOTE' })
    expect(await collectReferences('compare @notes/idea.md please')).toEqual([
      { path: 'notes/idea.md', content: 'IDEA_BODY' }
    ])
    // A leading /name is a skill, and a skill has no contents to send.
    expect(await collectReferences('/unslop summarise this')).toEqual([])
    // A bare path with no marker is not a reference: it is prose.
    expect(await collectReferences('open notes/idea.md and compare')).toEqual([])
    // A leading slash on a path is still a file. It is only a bare /name, with
    // nothing after it, that is a skill invocation.
    expect(await collectReferences('look at /notes/idea.md')).toEqual([
      { path: 'notes/idea.md', content: 'IDEA_BODY' }
    ])
  })

  it('treats an @ mention as a file even when a skill of that name exists', async () => {
    const root = makeTempRoot('refs-skill')
    try {
      const folder = join(root, 'Skills')
      mkdirSync(folder, { recursive: true })
      writeFileSync(
        join(folder, 'Unslop.md'),
        '---\nname: unslop\ndescription: Cut filler.\n---\nRULES'
      )
      expect(listSkills(root).skills.some((skill) => skill.name === 'unslop')).toBe(true)
      expect(requestedSkill(root, '/unslop tidy this')).toMatchObject({ name: 'unslop' })

      // The prompt says what it means: this / is a file in the vault.
      stubVault({ 'unslop.md': 'A_NOTE_CALLED_UNSLOP' })
      expect(await collectReferences('read /unslop.md')).toEqual([
        { path: 'unslop.md', content: 'A_NOTE_CALLED_UNSLOP' }
      ])
    } finally {
      cleanupTempRoot(root)
    }
  })

  it('tells the model which is which, since only it sees the raw prompt', () => {
    const system = assistantInstructions(false)
    // Without this the model has to guess from a path that looks like a command.
    expect(system).toMatch(/`@path` is a file/)
    expect(system).toMatch(/`\/name` is a personal skill/)
    expect(system).toMatch(/never as something to read, summarise, or edit/)
  })

  it('applies the Unslop rules to every reply, not only when asked', () => {
    const normal = assistantInstructions(false)
    expect(normal).toMatch(/Apply the Unslop skill to every reply/)
    // Selection actions are read-only but not exempt from house style.
    expect(assistantInstructions(true)).toMatch(/Apply the Unslop skill to every reply/)
  })
})

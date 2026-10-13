import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { cleanupTempRoot, makeTempRoot } from './helpers/temp-root'
import { ensureSkillsFolder, listSkills, requestedSkill, skillsFolder } from '../src/main/ai/skills'

let root: string

/** WriteMd's own style skill, seeded into every vault's Skills folder. */
const SHIPPED_SKILL = 'unslop'

beforeEach(() => {
  root = makeTempRoot('skills')
})
afterEach(() => cleanupTempRoot(root))

function add(name: string, text: string): void {
  const folder = join(ensureSkillsFolder(root), name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), text)
}

/**
 * The user's own skills, without the one WriteMd ships.
 *
 * Every vault has `Unslop.md` in its skills folder from the moment it is
 * created, so an assertion about "what the user added" has to say so. Filtering
 * here rather than in each test keeps the assertions about their actual subject.
 */
function ownSkills(): Array<{ name: string; description: string }> {
  return listSkills(root).skills.filter((skill) => skill.name !== SHIPPED_SKILL)
}

describe('personal AI skills', () => {
  it('ships the Unslop skill with a new vault and never overwrites it', () => {
    const folder = ensureSkillsFolder(root)
    const shipped = join(folder, 'Unslop.md')
    expect(existsSync(shipped)).toBe(true)
    expect(readFileSync(shipped, 'utf8')).toContain('Cut')
    expect(requestedSkill(root, '/unslop')).toMatchObject({
      name: SHIPPED_SKILL,
      instructions: expect.stringContaining('Unslop')
    })
    // A user who edits it has made it theirs.
    writeFileSync(shipped, '# MY OWN RULES')
    ensureSkillsFolder(root)
    expect(readFileSync(shipped, 'utf8')).toBe('# MY OWN RULES')
  })

  it('uses a visible vault folder and accepts flat files and a root SKILL.md', () => {
    const folder = ensureSkillsFolder(root)
    expect(folder).toBe(join(root, 'Skills'))
    writeFileSync(join(folder, 'proofread.md'), '# PROOFREAD_GUIDANCE')
    writeFileSync(join(folder, 'SKILL.md'), '# DEFAULT_GUIDANCE')
    add('outline', '# OUTLINE_GUIDANCE')
    expect(listSkills(root).skills.map((skill) => skill.name)).toEqual([
      'outline',
      'proofread',
      'skill',
      SHIPPED_SKILL
    ])
    expect(requestedSkill(root, '/proofread')).toMatchObject({
      instructions: '# PROOFREAD_GUIDANCE'
    })
    expect(requestedSkill(root, '/skill')).toMatchObject({ instructions: '# DEFAULT_GUIDANCE' })
  })
  it('finds newly added capitalized skill files by their frontmatter name', () => {
    const folder = ensureSkillsFolder(root)
    writeFileSync(
      join(folder, 'Unslop.MD'),
      '---\nname: unslop\ndescription: Keep writing direct.\n---\nAvoid filler.'
    )
    expect(listSkills(root).skills).toEqual([
      { name: 'unslop', description: 'Keep writing direct.' }
    ])
    expect(requestedSkill(root, '/unslop rewrite this')).toMatchObject({
      instructions: expect.stringContaining('Avoid filler.')
    })
  })
  it('keeps legacy skills available and gives visible skills precedence', () => {
    const legacy = join(root, '.writemd', 'skills', 'proofread')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'SKILL.md'), 'LEGACY_GUIDANCE')
    ensureSkillsFolder(root)
    expect(requestedSkill(root, '/proofread')).toMatchObject({ instructions: 'LEGACY_GUIDANCE' })
    add('proofread', 'VISIBLE_GUIDANCE')
    // The legacy copy is shadowed by the visible one, so only one `proofread`.
    expect(listSkills(root).skills.filter((skill) => skill.name === 'proofread')).toHaveLength(1)
    expect(requestedSkill(root, '/proofread')).toMatchObject({ instructions: 'VISIBLE_GUIDANCE' })
  })
  it('lists no user skills, and creates no folder, during ordinary chat', () => {
    // No ensureSkillsFolder call: listing must not seed anything either, or a
    // read would have a side effect on the user's vault.
    expect(listSkills(root)).toEqual({ folder: skillsFolder(root), skills: [], warnings: [] })
    expect(requestedSkill(root, 'Explain /proofread syntax')).toBeUndefined()
  })
  it('loads only the explicitly requested skill, with edits read fresh', () => {
    add('proofread', '---\ndescription: "Fix grammar"\n---\nPRESERVE_VOICE')
    add('other', '# OTHER_PRIVATE_INSTRUCTIONS')
    expect(ownSkills()).toEqual([
      { name: 'other', description: 'OTHER_PRIVATE_INSTRUCTIONS' },
      { name: 'proofread', description: 'Fix grammar' }
    ])
    expect(requestedSkill(root, '/proofread improve this')).toMatchObject({
      name: 'proofread',
      instructions: expect.stringContaining('PRESERVE_VOICE')
    })
    expect(requestedSkill(root, 'Use a normal prompt')).toBeUndefined()
    add('proofread', '# UPDATED_GUIDANCE')
    expect(requestedSkill(root, '/proofread')).toMatchObject({ instructions: '# UPDATED_GUIDANCE' })
  })
  it('rejects missing, empty, and oversized instructions instead of silently ignoring them', () => {
    add('empty', '')
    add('large', 'x'.repeat(16_385))
    expect(ownSkills()).toEqual([])
    expect(listSkills(root).warnings.join(' ')).toMatch(/empty.*empty.*large.*16 KB/)
    expect(() => requestedSkill(root, '/missing test')).toThrow('Check Skills in AI Settings')
  })

  it('ignores unrelated entries before the listing cap and can invoke a skill beyond it', () => {
    const folder = ensureSkillsFolder(root)
    for (let index = 0; index < 65; index++) writeFileSync(join(folder, `000-${index}.txt`), 'junk')
    add('proofread', 'STYLE')
    expect(ownSkills()).toEqual([{ name: 'proofread', description: 'proofread' }])
    for (let index = 0; index < 65; index++)
      add(`a-${String(index).padStart(2, '0')}`, 'Other skill')
    expect(listSkills(root).skills.some((skill) => skill.name === 'proofread')).toBe(false)
    expect(requestedSkill(root, '/proofread')).toMatchObject({ instructions: 'STYLE' })
  })
  it('does not follow a skill folder junction outside the vault', () => {
    const outside = makeTempRoot('outside-skills')
    try {
      writeFileSync(join(outside, 'SKILL.md'), 'OUTSIDE_PRIVATE')
      symlinkSync(outside, join(ensureSkillsFolder(root), 'escape'), 'junction')
      expect(listSkills(root).skills.some((skill) => skill.name === 'escape')).toBe(false)
      expect(() => requestedSkill(root, '/escape')).toThrow('could not be read')
    } finally {
      cleanupTempRoot(outside)
    }
  })
  it('rejects a linked Skills folder before accessing another directory', () => {
    const outside = makeTempRoot('outside-parent')
    try {
      symlinkSync(outside, join(root, 'Skills'), 'junction')
      expect(() => ensureSkillsFolder(root)).toThrow('inside your vault')
      expect(listSkills(root).warnings).toHaveLength(1)
    } finally {
      cleanupTempRoot(outside)
    }
  })
})

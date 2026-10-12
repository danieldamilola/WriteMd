import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

/**
 * Dropping a document onto a folder row moves it into that folder.
 *
 * The destination for "onto a group" has existed for a while, but nothing told
 * the user it was happening: hovering a folder header painted the same solid
 * outline as hovering a gap between two rows, so the two gestures were
 * indistinguishable. These pin the treatment and the two ways it used to go
 * wrong - teleporting a tab to the bottom of the folder it was already in, and
 * dropping into a closed folder where the tab then became invisible.
 */
async function open(name: string): Promise<{
  app: Awaited<ReturnType<typeof launch>>
  page: Awaited<ReturnType<typeof firstWindow>>
}> {
  const fixture = makeFixture(`folder-drop-${name}`)
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify(
      {
        files: { vaultPath: fixture.vault, recentFiles: [], openTabs: [], activeTabPath: null },
        appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' }
      },
      null,
      2
    ),
    'utf-8'
  )
  const app = await launch(fixture)
  const page = await firstWindow(app)
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.evaluate((vault: string) => {
    const el = document.querySelector('writemd-app') as unknown as {
      fileState: { openTab(path: string): Promise<void> }
    }
    for (const n of ['PRD.md', 'README.md', 'CHANGELOG.md']) {
      void el.fileState.openTab(`${vault}/${n}`)
    }
  }, fixture.vault)
  await page.waitForTimeout(900)
  return { app, page }
}

const createGroup = (page: import('@playwright/test').Page, members: number[]): Promise<void> =>
  page.evaluate((indices: number[]) => {
    const el = document.querySelector('writemd-app') as unknown as {
      fileState: { createTabGroup(label: string, icon?: string, tabIndices?: number[]): string }
    }
    el.fileState.createTabGroup('Work', undefined, indices)
  }, members)

const groupOf = (
  page: import('@playwright/test').Page,
  id: string
): Promise<{ index: number; groupId: string | null }> =>
  page.evaluate((tabId: string) => {
    const el = document.querySelector('writemd-app') as unknown as {
      fileState: { getState(): { tabs?: Array<{ id?: string; groupId?: string | null }> } }
    }
    const tabs = el.fileState.getState().tabs ?? []
    const found = tabs.find((t) => t.id === tabId)
    return { index: tabs.findIndex((t) => t.id === tabId), groupId: found?.groupId ?? null }
  }, id)

/** Press, move past the activation distance, land on the folder, release. */
async function dragOnto(page: import('@playwright/test').Page, sourceSel: string): Promise<void> {
  const source = page.locator(sourceSel).first()
  const group = page.locator('writemd-vertical-tab-bar .group-header').first()
  const s = (await source.boundingBox())!
  const g = (await group.boundingBox())!
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 10, { steps: 4 })
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 12 })
  await page.waitForTimeout(350)
  await page.mouse.up()
  await page.waitForTimeout(600)
}

test('hovering a folder marks it for drop, distinctly from an insertion point', async () => {
  const { app, page } = await open('feedback')
  await createGroup(page, [])
  await page.waitForTimeout(700)
  const source = page.locator('writemd-vertical-tab-bar .tab-row[data-tab-id]').first()
  const group = page.locator('writemd-vertical-tab-bar .group-header').first()
  const s = (await source.boundingBox())!
  const g = (await group.boundingBox())!

  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 10, { steps: 4 })
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 12 })
  await page.waitForTimeout(350)

  const header = page.locator('writemd-vertical-tab-bar .group-header').first()
  await expect(header).toHaveClass(/drag-over/)
  // Not the insertion outline: that one means "between these two rows", and
  // sharing it is what made the folder drop invisible.
  await expect(header).not.toHaveAttribute('data-drop-target', /.*/)
  await expect(header).toHaveCSS('outline-style', 'dashed')

  await page.mouse.up()
  await app.close()
})

test('dropping a loose document onto a folder moves it in', async () => {
  const { app, page } = await open('into')
  await createGroup(page, [])
  await page.waitForTimeout(700)
  const source = page.locator('writemd-vertical-tab-bar .tab-row[data-tab-id]').first()
  const tabId = (await source.getAttribute('data-tab-id'))!
  const before = await groupOf(page, tabId)

  await dragOnto(page, 'writemd-vertical-tab-bar .tab-row[data-tab-id]')
  const after = await groupOf(page, tabId)

  expect(before.groupId).toBeNull()
  expect(after.groupId).not.toBeNull()
  await page.screenshot({ path: 'artifacts/ui-review/folder-drop-into.png' })
  await app.close()
})

test('dropping a document onto its own folder leaves it where it was', async () => {
  const { app, page } = await open('own')
  await createGroup(page, [0, 1])
  await page.waitForTimeout(700)

  // Identity, not position: the first tab already inside the folder.
  const source = page.locator('writemd-vertical-tab-bar .group-tabs .tab-row[data-tab-id]').first()
  const tabId = (await source.getAttribute('data-tab-id'))!
  const before = await groupOf(page, tabId)

  await dragOnto(page, 'writemd-vertical-tab-bar .group-tabs .tab-row[data-tab-id]')
  const after = await groupOf(page, tabId)

  // Regression: the folder header read as "into this folder", which produced a
  // destination with no neighbour, which placeTab reads as "append". Hovering
  // your own folder silently moved the document to the bottom of it.
  expect(after.index).toBe(before.index)
  expect(after.groupId).toBe(before.groupId)
  await app.close()
})

test('dropping into a closed folder opens it so the document is not lost', async () => {
  const { app, page } = await open('closed')
  await createGroup(page, [])
  await page.waitForTimeout(700)
  // Close the folder.
  await page.locator('writemd-vertical-tab-bar .group-header').first().click()
  await page.waitForTimeout(500)
  const group = page.locator('writemd-vertical-tab-bar .group-header').first()
  await expect(page.locator('writemd-vertical-tab-bar .group-tabs')).toBeHidden()

  const source = page.locator('writemd-vertical-tab-bar .tab-row[data-tab-id]').first()
  const tabId = (await source.getAttribute('data-tab-id'))!
  await dragOnto(page, 'writemd-vertical-tab-bar .tab-row[data-tab-id]')

  const after = await groupOf(page, tabId)
  expect(after.groupId).not.toBeNull()
  // A closed folder renders no rows, so committing into one hid the document
  // with no way to find it again.
  await expect(page.locator('writemd-vertical-tab-bar .group-tabs')).toBeVisible()
  await expect(group).toBeVisible()
  await app.close()
})

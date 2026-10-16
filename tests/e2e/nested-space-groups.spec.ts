import { expect, test, type Page, type Locator } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { firstWindow, launch, makeFixture, resizeWindow } from './fixtures'

test.setTimeout(120_000)

async function dragGroup(
  page: Page,
  source: string,
  target: string,
  fraction = 0.5
): Promise<void> {
  const sidebar = page.locator('writemd-vertical-tab-bar')
  const from = await sidebar.locator(`.group-header[data-group-id="${source}"]`).boundingBox()
  const to = await sidebar.locator(`.group-header[data-group-id="${target}"]`).boundingBox()
  if (!from || !to) throw new Error('Missing group header')
  await page.mouse.move(from.x + from.width * 0.6, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width * 0.6, from.y + from.height / 2 + 8, { steps: 4 })
  await page.mouse.move(to.x + to.width * 0.6, to.y + to.height * fraction, { steps: 14 })
  await page.mouse.up()
}

test('Space groups nest by dragging, reject cycles, and restore with their tabs', async () => {
  const fixture = makeFixture('nested-space-groups')
  const configPath = join(fixture.userData, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.files.openTabs = ['README.md', 'PRD.md', 'CHANGELOG.md'].map((name) =>
    join(fixture.vault, name)
  )
  config.files.activeTabPath = config.files.openTabs[0]
  config.appearance.theme = 'graphite'
  config.appearance.panelOrientation = 'vertical'
  config.appearance.motion = 'reduced'
  writeFileSync(configPath, JSON.stringify(config))
  const app = await launch(fixture)
  try {
    const page = await firstWindow(app)
    await resizeWindow(app, 1100, 800)
    await expect(page.locator('writemd-vertical-tab-bar writemd-tab')).toHaveCount(3)
    const groups = await page.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as {
        fileState: {
          createTabGroup(label: string, icon?: string, indices?: number[]): string
          moveTabGroup(id: string, parentId: string | null): void
          toggleTabGroupCollapse(id: string): void
        }
      }
      const youtube = host.fileState.createTabGroup('YouTube', 'star', [0])
      const work = host.fileState.createTabGroup('WriteMd', undefined, [1])
      const transcripts = host.fileState.createTabGroup('Transcripts', undefined, [2])
      host.fileState.moveTabGroup(transcripts, youtube)
      host.fileState.toggleTabGroupCollapse(work)
      return { youtube, work, transcripts }
    })
    const sidebar = page.locator('writemd-vertical-tab-bar')
    const container = (id: string): Locator =>
      sidebar.locator(`.tab-group-container[data-group-id="${id}"]`)
    const header = (id: string): Locator => sidebar.locator(`.group-header[data-group-id="${id}"]`)
    await expect(header(groups.transcripts)).toBeVisible()
    await dragGroup(page, groups.youtube, groups.work)
    await expect(
      container(groups.work).locator(`.tab-group-container[data-group-id="${groups.youtube}"]`)
    ).toBeVisible()
    await expect(header(groups.work)).toHaveAttribute('aria-expanded', 'true')
    await expect(
      container(groups.youtube).locator(
        `.tab-group-container[data-group-id="${groups.transcripts}"]`
      )
    ).toBeVisible()
    await expect(sidebar.locator('writemd-tab[active]')).toHaveAttribute('label', 'README.md')
    await expect(
      container(groups.youtube).locator(`.tab-row[data-group-id="${groups.youtube}"] writemd-tab`)
    ).toHaveAttribute('label', 'README.md')
    await expect(container(groups.transcripts).locator('writemd-tab')).toHaveAttribute(
      'label',
      'CHANGELOG.md'
    )
    await page.screenshot({ path: 'artifacts/ui-review/nested-space-groups.png' })

    // A parent cannot be nested in its own descendant.
    await dragGroup(page, groups.work, groups.transcripts)
    await expect
      .poll(() => {
        const saved = JSON.parse(readFileSync(configPath, 'utf8'))
        return (
          JSON.parse(saved.files.tabGroups).groups.find(
            (group: { id: string }) => group.id === groups.work
          ).parentId ?? null
        )
      })
      .toBeNull()
    await header(groups.work).press('Enter')
    await expect(header(groups.youtube)).toHaveCount(0)
    await header(groups.work).press('Enter')
    await expect(header(groups.youtube)).toBeVisible()

    await expect
      .poll(() => {
        const saved = JSON.parse(readFileSync(configPath, 'utf8'))
        return JSON.parse(saved.files.tabGroups).groups.find(
          (group: { id: string }) => group.id === groups.youtube
        ).parentId
      })
      .toBe(groups.work)
    await page.reload()
    await expect(
      container(groups.work).locator(`.tab-group-container[data-group-id="${groups.youtube}"]`)
    ).toBeVisible()
    await expect(sidebar.locator('writemd-tab[active]')).toHaveAttribute('label', 'README.md')
    await expect(
      container(groups.youtube).locator(`.tab-row[data-group-id="${groups.youtube}"] writemd-tab`)
    ).toHaveAttribute('label', 'README.md')

    // Return a nested group to Space without moving or closing its documents.
    await header(groups.youtube).click({ button: 'right' })
    await sidebar.getByText('Move to Space', { exact: true }).click()
    await expect(
      container(groups.work).locator(`.tab-group-container[data-group-id="${groups.youtube}"]`)
    ).toHaveCount(0)
    await expect(
      container(groups.youtube).locator(
        `.tab-group-container[data-group-id="${groups.transcripts}"]`
      )
    ).toBeVisible()

    // Top/bottom edges remain sibling reorder targets.
    await dragGroup(page, groups.youtube, groups.work, 0.08)
    await expect
      .poll(() =>
        sidebar
          .locator('.scroll-container > .tab-group-container')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-group-id'))
          )
      )
      .toEqual([groups.youtube, groups.work])

    await page.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as {
        settingsStore: { set(key: string, value: string): void }
      }
      host.settingsStore.set('appearance.panelOrientation', 'horizontal')
    })
    const horizontal = page.locator('writemd-app .tab-strip')
    await expect(
      horizontal.locator(
        `.h-group-wrap[data-group-id="${groups.youtube}"] .h-group-wrap[data-group-id="${groups.transcripts}"]`
      )
    ).toBeVisible()
    await expect(horizontal.locator('.h-group-pill')).toHaveCount(3)

    const horizontalHeader = (id: string): Locator =>
      horizontal.locator(`.h-group-pill[data-group-id="${id}"]`)
    // Exercise the horizontal drag controller itself, with both source and target collapsed.
    await horizontalHeader(groups.youtube).press('Enter')
    await horizontalHeader(groups.work).press('Enter')
    const from = await horizontalHeader(groups.youtube).boundingBox()
    const to = await horizontalHeader(groups.work).boundingBox()
    if (!from || !to) throw new Error('Missing horizontal group header')
    await page.mouse.move(from.x + from.width * 0.7, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width * 0.7 + 8, from.y + from.height / 2, { steps: 4 })
    await page.mouse.move(to.x + to.width * 0.5, to.y + to.height / 2, { steps: 14 })
    await page.mouse.up()
    await expect(
      horizontal.locator(
        `.h-group-wrap[data-group-id="${groups.work}"] .h-group-wrap[data-group-id="${groups.youtube}"]`
      )
    ).toBeVisible()
    await expect(horizontalHeader(groups.work)).toHaveAttribute('aria-expanded', 'true')
    await horizontalHeader(groups.youtube).press('Enter')
    await expect(horizontalHeader(groups.transcripts)).toBeVisible()
    await expect
      .poll(() => {
        const saved = JSON.parse(readFileSync(configPath, 'utf8'))
        return JSON.parse(saved.files.tabGroups).groups.find(
          (group: { id: string }) => group.id === groups.youtube
        ).parentId
      })
      .toBe(groups.work)
    await page.screenshot({ path: 'artifacts/ui-review/nested-space-groups-horizontal.png' })
    await page.reload()
    await expect(
      horizontal.locator(
        `.h-group-wrap[data-group-id="${groups.work}"] .h-group-wrap[data-group-id="${groups.youtube}"]`
      )
    ).toBeVisible()
    await horizontalHeader(groups.youtube).click({ button: 'right' })
    await page.locator('writemd-app').getByText('Move to Space', { exact: true }).click()
    await expect(
      horizontal.locator(
        `.h-group-wrap[data-group-id="${groups.work}"] .h-group-wrap[data-group-id="${groups.youtube}"]`
      )
    ).toHaveCount(0)
    await expect(horizontalHeader(groups.transcripts)).toBeVisible()
  } finally {
    await app.close()
    fixture.cleanup()
  }
})

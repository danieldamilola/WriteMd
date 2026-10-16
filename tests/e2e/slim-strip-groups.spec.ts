import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow, resizeWindow } from './fixtures'
import type { FileState } from '../../src/renderer/src/state/file-state'

async function open(name: string): Promise<{
  app: Awaited<ReturnType<typeof launch>>
  page: Page
}> {
  const fixture = makeFixture(`slim-groups-${name}`)
  const path = join(fixture.vault, 'README.md')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify({
      files: {
        vaultPath: fixture.vault,
        recentFiles: [path],
        openTabs: [path],
        activeTabPath: path
      },
      appearance: {
        designVersion: 1,
        theme: 'graphite',
        panelOrientation: 'vertical',
        motion: 'reduced'
      }
    })
  )
  const app = await launch(fixture)
  const page = await firstWindow(app)
  await resizeWindow(app, 1100, 800)
  await expect(page.locator('writemd-vertical-tab-bar writemd-tab')).toHaveCount(1)
  await page.evaluate(() => {
    const { fileState } = document.querySelector('writemd-app') as unknown as {
      fileState: FileState
    }
    fileState.createTabGroup('Youtube', 'star', [])
    fileState.createTabGroup('Stride', 'code', [])
    fileState.createTabGroup('Vault', undefined, [])
  })
  await expect(page.locator('writemd-vertical-tab-bar .group-label')).toHaveCount(3)
  return { app, page }
}

async function collapse(page: Page): Promise<void> {
  await page
    .locator('writemd-sidebar')
    .getByRole('button', { name: 'Collapse panel', exact: true })
    .click()
  await expect(page.locator('writemd-sidebar .slim-group')).toHaveCount(3)
}

test('the collapsed strip keeps one icon per group', async () => {
  const { app, page } = await open('icons')
  try {
    await collapse(page)
    const icons = page.locator('writemd-sidebar .slim-group')
    await expect(icons.nth(0)).toHaveAttribute('title', 'Youtube')
    await expect(icons.nth(1)).toHaveAttribute('title', 'Stride')
    await expect(icons.nth(2)).toHaveAttribute('title', 'Vault')
    await expect(icons.nth(0).locator('svg')).toHaveAttribute('data-icon', 'star')
    await expect(icons.nth(1).locator('svg')).toHaveAttribute('data-icon', 'code')
    await expect(icons.nth(2).locator('svg')).toHaveAttribute('data-icon', 'folder-open')
  } finally {
    await app.close()
  }
})

test('clicking a group icon opens its card and keeps the sidebar collapsed', async () => {
  const { app, page } = await open('open')
  try {
    await collapse(page)
    await page.locator('writemd-sidebar .slim-group').nth(1).click()
    const card = page.locator('writemd-group-card')
    await expect(card.locator('.heading')).toHaveText('Stride')
    await expect(card.getByRole('searchbox', { name: 'Search folder' })).toBeFocused()
    await expect(
      page.locator('writemd-sidebar').getByRole('button', { name: 'Expand panel', exact: true })
    ).toBeVisible()
    expect(
      await page
        .locator('writemd-rail-frame')
        .evaluate((element) => element.getBoundingClientRect().width)
    ).toBeLessThanOrEqual(48)
  } finally {
    await app.close()
  }
})

test('a closed group opens in a card without changing its saved expansion state', async () => {
  const { app, page } = await open('closed-group')
  try {
    await page.evaluate(() => {
      const { fileState } = document.querySelector('writemd-app') as unknown as {
        fileState: FileState
      }
      fileState.toggleTabGroupCollapse(fileState.getState().tabGroups![2].id)
    })
    await collapse(page)
    await page.locator('writemd-sidebar .slim-group').nth(2).click()
    await expect(page.locator('writemd-group-card .heading')).toHaveText('Vault')
    const group = await page.evaluate(
      () =>
        (
          document.querySelector('writemd-app') as unknown as { fileState: FileState }
        ).fileState.getState().tabGroups![2]
    )
    expect(group.collapsed).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.locator('writemd-group-card')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

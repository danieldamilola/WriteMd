import { test, expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

async function open(name: string): Promise<{
  app: Awaited<ReturnType<typeof launch>>
  page: Awaited<ReturnType<typeof firstWindow>>
}> {
  const fixture = makeFixture(`slim-groups-${name}`)
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
  await page.waitForTimeout(1100)
  await page.evaluate((vault: string) => {
    const el = document.querySelector('writemd-app') as unknown as {
      fileState: {
        openTab(path: string): Promise<void>
        createTabGroup(label: string, icon?: string, tabIndices?: number[]): string
      }
    }
    // A document has to be open or the panel expands onto the welcome screen
    // and the group rows never mount.
    void el.fileState.openTab(`${vault}/README.md`)
    el.fileState.createTabGroup('Youtube', 'star', [])
    el.fileState.createTabGroup('Stride', 'code', [])
    el.fileState.createTabGroup('Vault', undefined, [])
  }, fixture.vault)
  await page.waitForTimeout(700)
  return { app, page }
}

const collapse = (page: import('@playwright/test').Page): Promise<void> =>
  page.evaluate(() => {
    const el = document.querySelector('writemd-app') as unknown as {
      toggleVerticalPanel(): void
    }
    el.toggleVerticalPanel()
  })

test('the collapsed strip keeps one icon per group', async () => {
  const { app, page } = await open('icons')
  await collapse(page)
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'artifacts/ui-review/slim-strip-groups.png' })

  const icons = page.locator('writemd-sidebar .slim-group')
  await expect(icons).toHaveCount(3)
  await expect(icons.nth(0)).toHaveAttribute('title', 'Youtube')
  await expect(icons.nth(1)).toHaveAttribute('title', 'Stride')
  await expect(icons.nth(2)).toHaveAttribute('title', 'Vault')
  // Each carries the same glyph the expanded row shows.
  await expect(icons.nth(0).locator('svg')).toHaveAttribute('data-icon', 'star')
  await expect(icons.nth(1).locator('svg')).toHaveAttribute('data-icon', 'code')
  await expect(icons.nth(2).locator('svg')).toHaveAttribute('data-icon', 'folder-open')
  await app.close()
})

test('clicking a group icon reopens the panel on that folder', async () => {
  const { app, page } = await open('open')
  await collapse(page)
  await page.waitForTimeout(900)
  await page.locator('writemd-sidebar .slim-group').nth(1).click()
  // The rail widening and the tab bar mounting are two separate renders.
  await expect(page.locator('writemd-vertical-tab-bar')).toBeVisible({ timeout: 10000 })

  // The panel is back.
  await expect
    .poll(() =>
      page.locator('writemd-rail-frame').evaluate((el) => el.getBoundingClientRect().width)
    )
    .toBeGreaterThan(100)
  // And the chosen group is the one on screen.
  await expect(page.locator('writemd-vertical-tab-bar .group-label').nth(1)).toHaveText('Stride')
  await page.screenshot({ path: 'artifacts/ui-review/slim-strip-opened.png' })
  await app.close()
})

test('a closed group is opened by its icon rather than staying shut', async () => {
  const { app, page } = await open('closed-group')
  await page.evaluate(() => {
    const el = document.querySelector('writemd-app') as unknown as {
      fileState: {
        getState(): { tabGroups: Array<{ id: string; collapsed: boolean }> }
        toggleTabGroupCollapse(id: string): void
      }
    }
    const third = el.fileState.getState().tabGroups[2]
    el.fileState.toggleTabGroupCollapse(third.id)
  })
  await page.waitForTimeout(600)
  await collapse(page)
  await page.waitForTimeout(900)
  await page.locator('writemd-sidebar .slim-group').nth(2).click()
  await page.waitForTimeout(900)

  const state = await page.evaluate(() => {
    const el = document.querySelector('writemd-app') as unknown as {
      fileState: { getState(): { tabGroups: Array<{ label: string; collapsed: boolean }> } }
    }
    return el.fileState.getState().tabGroups.map((g) => `${g.label}=${g.collapsed}`)
  })
  expect(state[2]).toBe('Vault=false')
  await app.close()
})

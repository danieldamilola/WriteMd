import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'
import type { FileState } from '../../src/renderer/src/state/file-state'
import type { SettingsStore } from '../../src/renderer/src/state/settings'
import { GROUP_ICON_PRESETS } from '../../src/renderer/src/state/group-icons'

type Host = { fileState: FileState; settingsStore: SettingsStore }

test.describe('Group row consistency', () => {
  let app: ElectronApplication
  let page: Page
  let groupId: string
  let configPath: string

  test.beforeEach(async () => {
    const fixture = makeFixture('group-row-consistency')
    configPath = join(fixture.userData, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      files: { openTabs: string[] }
    }
    config.files.openTabs = ['README.md', 'PRD.md', 'CHANGELOG.md'].map((name) =>
      join(fixture.vault, name)
    )
    writeFileSync(configPath, JSON.stringify(config))
    app = await launch(fixture)
    page = await firstWindow(app)
    await expect(page.locator('writemd-tab')).toHaveCount(3)
    groupId = await page.evaluate(() => {
      const host = document.querySelector('writemd-app') as unknown as Host
      host.settingsStore.setMany({ 'appearance.motion': 'reduced', 'editor.autoSave': false })
      const id = host.fileState.createTabGroup('Youtube', undefined, [1])
      host.fileState.createTabGroup('Research notes', 'star', [2])
      return id
    })
  })

  test.afterEach(async () => {
    await app?.close()
  })

  for (const orientation of ['vertical', 'horizontal']) {
    test(`matches note geometry and keeps folder controls working in ${orientation} tabs`, async () => {
      const headerClass = orientation === 'vertical' ? '.group-header' : '.h-group-pill'
      const labelClass = orientation === 'vertical' ? '.group-label' : '.h-group-label'
      const iconClass = orientation === 'vertical' ? '.group-icon' : '.h-group-icon'
      const group = page.locator(`${headerClass}[data-group-id="${groupId}"]`)
      for (const theme of ['graphite', 'light']) {
        await page.evaluate(
          ({ orientation, theme }) => {
            const host = document.querySelector('writemd-app') as unknown as Host
            host.settingsStore.setMany({
              'appearance.panelOrientation': orientation,
              'appearance.theme': theme
            })
          },
          { orientation, theme }
        )
        await expect(group.locator('svg[data-icon="folder-open"]')).toBeVisible()
        const note = page.locator('writemd-tab[label="README.md"]')
        const noteGeometry = await note.evaluate((element) => {
          const button = element.shadowRoot!.querySelector('.tab-btn')!
          const label = element.shadowRoot!.querySelector('.label')!
          const icon = element.shadowRoot!.querySelector('svg[data-icon="file-text"]')
          const style = getComputedStyle(button)
          return {
            font: style.fontFamily,
            size: style.fontSize,
            line: style.lineHeight,
            gap: style.gap,
            height: button.getBoundingClientRect().height,
            // Horizontal notes omit the icon; group folders keep the shared size.
            iconWidth: icon?.getBoundingClientRect().width ?? 18,
            labelOffset: label.getBoundingClientRect().left - button.getBoundingClientRect().left
          }
        })
        for (const row of await page.locator(headerClass).all()) {
          const geometry = await row.evaluate(
            (element, { labelClass, iconClass }) => {
              const style = getComputedStyle(element)
              const label = element.querySelector(labelClass)!
              const icon = element.querySelector(`${iconClass} svg`)!
              return {
                font: style.fontFamily,
                size: style.fontSize,
                line: style.lineHeight,
                gap: style.gap,
                height: element.getBoundingClientRect().height,
                iconWidth: icon.getBoundingClientRect().width,
                labelOffset:
                  label.getBoundingClientRect().left - element.getBoundingClientRect().left
              }
            },
            { labelClass, iconClass }
          )
          const { labelOffset: groupOffset, ...groupStyle } = geometry
          const { labelOffset: noteOffset, ...noteStyle } = noteGeometry
          expect(groupStyle).toEqual(noteStyle)
          if (orientation === 'vertical') expect(groupOffset).toBe(noteOffset)
        }
        await page.screenshot({ path: `artifacts/ui-review/groups-${theme}-${orientation}.png` })
      }
      await group.locator(iconClass).click()
      await expect(group.locator('svg[data-icon="folder"]')).toBeVisible()
      await expect(page.locator('writemd-tab[label="PRD.md"]')).not.toBeVisible()
      await group.click()
      await expect(group.locator('svg[data-icon="folder-open"]')).toBeVisible()
      await expect(page.locator('writemd-tab[label="PRD.md"]')).toBeVisible()
      await group.locator(labelClass).dblclick()
      const input = group.locator('input')
      await expect(input).toBeFocused()
      await expect(input).toHaveCSS('font-size', '13px')
      await input.fill('Video ideas')
      await input.press('Enter')
      await expect(group.locator(labelClass)).toHaveText('Video ideas')
    })

    test(`picks a group icon from the menu and keeps it in ${orientation} tabs`, async () => {
      const headerClass = orientation === 'vertical' ? '.group-header' : '.h-group-pill'
      const barSelector = orientation === 'vertical' ? 'writemd-vertical-tab-bar' : 'writemd-app'
      await page.evaluate((value) => {
        const host = document.querySelector('writemd-app') as unknown as Host
        host.settingsStore.setMany({
          'appearance.panelOrientation': value,
          'appearance.theme': 'graphite'
        })
      }, orientation)

      const group = page.locator(`${headerClass}[data-group-id="${groupId}"]`)
      // A new group keeps the folder pair until an icon is chosen.
      await expect(group.locator('svg[data-icon="folder-open"]')).toBeVisible()

      await group.click({ button: 'right' })
      const picker = page.locator(`${barSelector} .group-icon-picker`)
      await expect(picker).toBeVisible()
      // The picker offers the presets, not colours.
      await expect(picker.locator('.group-icon-choice')).toHaveCount(GROUP_ICON_PRESETS.length)

      await picker.locator('.group-icon-choice[title="Book"]').click()
      await expect(group.locator('svg[data-icon="book"]')).toBeVisible()
      await expect(group.locator('svg[data-icon="folder-open"]')).toHaveCount(0)

      // The choice reached state, not just the DOM.
      const stored = await page.evaluate((id) => {
        const host = document.querySelector('writemd-app') as unknown as Host
        return host.fileState.getState().tabGroups?.find((g) => g.id === id)?.icon
      }, groupId)
      expect(stored).toBe('book')

      // Reopening shows it marked as the current choice.
      await group.click({ button: 'right' })
      await expect(
        page.locator(`${barSelector} .group-icon-choice[title="Book"][aria-pressed="true"]`)
      ).toHaveCount(1)

      // And it was written to the profile, not just held in memory.
      await expect
        .poll(
          () => {
            const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
              files?: { tabGroups?: string }
            }
            const stored = JSON.parse(raw.files?.tabGroups ?? '{}') as {
              groups?: { id: string; icon?: string }[]
            }
            return stored.groups?.find((g) => g.id === groupId)?.icon
          },
          { message: 'group icon persisted to config.json' }
        )
        .toBe('book')

      await page.screenshot({ path: `artifacts/ui-review/group-icons-${orientation}.png` })
    })
  }
})

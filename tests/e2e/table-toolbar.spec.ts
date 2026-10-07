import { test, expect, type ElectronApplication, type Locator } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeFixture, launch, firstWindow } from './fixtures'

const NOTE = [
  '# Table toolbar',
  '',
  'The floating toolbar sits above the table the cursor is in.',
  '',
  '| Feature | Parser |',
  '| --- | --- |',
  '| Tables | yes |',
  '| Grids | yes |',
  ''
].join('\n')

/** No heading, no lead-in, so the table is the first thing in the document. */
const TABLE_AT_TOP = ['| A | B |', '| --- | --- |', '| 1 | 2 |', ''].join('\n')

/**
 * CodeMirror parks a tooltip it has not positioned yet at -10000px, and only
 * places it in a measure cycle. Reading the grip's box before then yields a
 * coordinate nothing is under, so the press goes nowhere and the drag silently
 * does nothing — which is what made this spec flaky under load.
 */
async function placed(toolbar: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await toolbar.boundingBox()
        return box !== null && box.y > 0 && box.y < 2000
      },
      { timeout: 15000 }
    )
    .toBe(true)
}

type Orientation = 'horizontal' | 'vertical'

/**
 * The toolbar is a CodeMirror tooltip pinned above the table, so on a short table
 * it lands over the text above it and there was nothing to move it. These run
 * the real app in both panel layouts, because the vertical rail changes the
 * pane the toolbar has to stay inside.
 */
async function run(orientation: Orientation): Promise<void> {
  const fixture = makeFixture(`table-toolbar-${orientation}`)
  const notePath = join(fixture.vault, 'table.md')
  writeFileSync(notePath, NOTE, 'utf-8')
  writeFileSync(
    join(fixture.userData, 'config.json'),
    JSON.stringify(
      {
        files: {
          vaultPath: fixture.vault,
          recentFiles: [notePath],
          openTabs: [notePath],
          activeTabPath: notePath
        },
        appearance: { designVersion: 1, theme: 'graphite', panelOrientation: orientation }
      },
      null,
      2
    ),
    'utf-8'
  )

  let app: ElectronApplication | undefined
  try {
    app = await launch(fixture)
    const window = await firstWindow(app)
    await expect(window.locator('writemd-top-bar')).toBeVisible()

    const toolbar = window.locator('.cm-table-toolbar')
    const grip = window.locator('.cm-table-grip')

    // Put the cursor in a table body cell. Clicking a rendered cell maps back to
    // its source range, which is what puts the selection inside the Table node.
    const cell = window.locator('.cm-live-table-cell').nth(2)
    await expect(cell).toBeVisible()
    await cell.click()
    await expect(toolbar).toBeVisible()
    await expect(grip).toBeVisible()
    await placed(toolbar)

    await window.screenshot({ path: `tmp-table-toolbar-${orientation}-1-anchored.png` })

    const before = await toolbar.evaluate((el) => ({
      transform: (el as HTMLElement).style.transform,
      box: el.getBoundingClientRect().toJSON()
    }))
    expect(before.transform).toBe('')

    const gripBox = (await grip.boundingBox())!
    await window.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
    await window.mouse.down()
    await window.mouse.move(gripBox.x + 90, gripBox.y + 110, { steps: 12 })
    await window.mouse.up()

    const after = await toolbar.evaluate((el) => ({
      transform: (el as HTMLElement).style.transform,
      box: el.getBoundingClientRect().toJSON()
    }))
    expect(after.transform).not.toBe('')
    // It followed the pointer, not the other way round.
    expect(Math.round(after.box.left - before.box.left)).toBeGreaterThan(60)
    expect(Math.round(after.box.top - before.box.top)).toBeGreaterThan(80)

    await window.screenshot({ path: `tmp-table-toolbar-${orientation}-2-dragged.png` })

    // The action buttons still work after a drag.
    await toolbar.locator('button').nth(1).click()
    await expect.poll(() => window.locator('.cm-live-table-cell').count()).toBeGreaterThan(4)

    // Dragged far past the top-left corner: it stops at the pane edge instead of
    // following the pointer off screen.
    const far = (await grip.boundingBox())!
    await window.mouse.move(far.x + far.width / 2, far.y + far.height / 2)
    await window.mouse.down()
    await window.mouse.move(40, 40, { steps: 12 })
    await window.mouse.up()

    const clamped = await toolbar.evaluate((el) => ({
      bar: el.getBoundingClientRect().toJSON(),
      pane: el.closest('.cm-editor')!.getBoundingClientRect().toJSON()
    }))
    expect(clamped.bar.left).toBeGreaterThanOrEqual(clamped.pane.left - 1)
    expect(clamped.bar.top).toBeGreaterThanOrEqual(clamped.pane.top - 1)
    await window.screenshot({ path: `tmp-table-toolbar-${orientation}-3-clamped.png` })

    // Double-click puts it back where CodeMirror anchored it.
    await grip.dblclick()
    await expect(toolbar).toHaveAttribute('style', /top: [^;]+; left: [^;]+;$/)
    expect(await toolbar.evaluate((el) => (el as HTMLElement).style.transform)).toBe('')
    await window.screenshot({ path: `tmp-table-toolbar-${orientation}-4-reset.png` })
  } finally {
    await app?.close()
    fixture.cleanup()
  }
}

test.describe('Draggable table toolbar', () => {
  test('moves, clamps and resets with the horizontal tab strip', async () => {
    await run('horizontal')
  })

  test('moves, clamps and resets with the vertical tab rail', async () => {
    await run('vertical')
  })

  /**
   * The offset is written to config.json, so where the user parked the toolbar
   * is still there tomorrow. A drag that only lived in a module variable would
   * pass every other case here and still put the toolbar back on the next launch.
   */
  test('comes back where it was left after a restart', async () => {
    const fixture = makeFixture('table-toolbar-restart')
    const notePath = join(fixture.vault, 'table.md')
    writeFileSync(notePath, NOTE, 'utf-8')
    const config = join(fixture.userData, 'config.json')
    writeFileSync(
      config,
      JSON.stringify(
        {
          files: {
            vaultPath: fixture.vault,
            recentFiles: [notePath],
            openTabs: [notePath],
            activeTabPath: notePath
          },
          appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'horizontal' }
        },
        null,
        2
      ),
      'utf-8'
    )

    let app: ElectronApplication | undefined
    try {
      app = await launch(fixture)
      const window = await firstWindow(app)
      await expect(window.locator('writemd-top-bar')).toBeVisible()
      const toolbar = window.locator('.cm-table-toolbar')
      await window.locator('.cm-live-table-cell').nth(2).click()
      await expect(toolbar).toBeVisible()

      // Move relative to the grip's centre, which is where the press lands, so
      // the offset is exactly the delta asked for.
      await placed(toolbar)
      const grip = (await window.locator('.cm-table-grip').boundingBox())!
      const cx = grip.x + grip.width / 2
      const cy = grip.y + grip.height / 2
      await window.mouse.move(cx, cy)
      await window.mouse.down()
      await window.mouse.move(cx + 120, cy + 100, { steps: 12 })
      await window.mouse.up()

      const dragged = await toolbar.evaluate((el) => (el as HTMLElement).style.transform)
      expect(dragged).toBe('translate(120px, 100px)')
      await expect
        .poll(() => JSON.parse(readFileSync(config, 'utf-8')))
        .toHaveProperty('editor.tableToolbarOffset', { x: 120, y: 100 })

      await app.close()
      app = await launch(fixture)
      const again = await firstWindow(app)
      await expect(again.locator('writemd-top-bar')).toBeVisible()
      await again.locator('.cm-live-table-cell').nth(2).click()
      await expect(again.locator('.cm-table-toolbar')).toBeVisible()
      expect(
        await again
          .locator('.cm-table-toolbar')
          .evaluate((el) => (el as HTMLElement).style.transform)
      ).toBe(dragged)
    } finally {
      await app?.close()
      fixture.cleanup()
    }
  })

  /**
   * The bug this exists for. CodeMirror anchors the toolbar above its table, and
   * for a table at the top of the document that is above the editor pane — which
   * in the vertical layout is inside the top bar. The top bar is a window drag
   * region, so a toolbar spawned there could not be pressed at all: the drag
   * moved the window instead of the toolbar.
   */
  test('a table at the top of the document still gets a reachable toolbar', async () => {
    const fixture = makeFixture('table-toolbar-top')
    const notePath = join(fixture.vault, 'table.md')
    writeFileSync(notePath, TABLE_AT_TOP, 'utf-8')
    writeFileSync(
      join(fixture.userData, 'config.json'),
      JSON.stringify(
        {
          files: {
            vaultPath: fixture.vault,
            recentFiles: [notePath],
            openTabs: [notePath],
            activeTabPath: notePath
          },
          appearance: { designVersion: 1, theme: 'graphite', panelOrientation: 'vertical' }
        },
        null,
        2
      ),
      'utf-8'
    )

    let app: ElectronApplication | undefined
    try {
      app = await launch(fixture)
      const window = await firstWindow(app)
      await expect(window.locator('writemd-top-bar')).toBeVisible()
      await expect(window.locator('writemd-vertical-tab-bar')).toBeVisible()

      const toolbar = window.locator('.cm-table-toolbar')
      await window.locator('.cm-live-table-cell').nth(0).click()
      await expect(toolbar).toBeVisible()
      // Let CodeMirror finish placing it, then let the clamp settle.
      await placed(toolbar)
      await window.waitForTimeout(300)

      const bar = (await toolbar.boundingBox())!
      const pane = (await window.locator('.cm-editor').first().boundingBox())!
      const topBar = (await window.locator('writemd-top-bar').boundingBox())!

      // Clear of the window-drag band, and inside the pane it belongs to.
      expect(bar.y).toBeGreaterThanOrEqual(topBar.y + topBar.height - 1)
      expect(bar.y).toBeGreaterThanOrEqual(pane.y - 1)
      expect(bar.x + bar.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
      await window.screenshot({ path: 'tmp-table-toolbar-top-1.png' })

      // And it takes a real press on the grip.
      await placed(toolbar)
      const grip = (await window.locator('.cm-table-grip').boundingBox())!
      await window.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
      await window.mouse.down()
      await window.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2 + 90, {
        steps: 12
      })
      await window.mouse.up()
      const moved = (await toolbar.boundingBox())!
      expect(Math.round(moved.x - bar.x)).toBeGreaterThan(80)
      expect(Math.round(moved.y - bar.y)).toBeGreaterThan(60)
      await window.screenshot({ path: 'tmp-table-toolbar-top-2.png' })
    } finally {
      await app?.close()
      fixture.cleanup()
    }
  })
})

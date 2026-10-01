import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { chromium } = require(
  join(process.cwd(), 'node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core')
)
const ELECTRON = require(join(process.cwd(), 'node_modules/electron'))

const ROOT = process.cwd()
const PORT = 9337
const THEMES = ['dark', 'graphite', 'midnight', 'light', 'paper', 'dracula', 'nord']

// Only the vars a theme is expected to derive. Anything still unresolved means
// the derivation chain is broken.
const DERIVED = [
  '--bg',
  '--bg-frame',
  '--bg-elevated',
  '--bg-secondary',
  '--bg-card',
  '--bg-code',
  '--bg-gutter',
  '--bg-hover',
  '--bg-active',
  '--text',
  '--text-secondary',
  '--text-muted',
  '--border',
  '--border-subtle',
  '--selection',
  '--danger-bg',
  '--success-bg',
  '--warning-bg',
  '--code-bg',
  '--menu-bg',
  '--scrim'
]

const root = join(tmpdir(), `writemd-tokens-${Date.now()}`)
const vault = join(root, 'vault')
const ud = join(root, 'ud')
mkdirSync(vault, { recursive: true })
mkdirSync(ud, { recursive: true })
writeFileSync(join(vault, 'a.md'), '# a\n\ntext\n')
writeFileSync(
  join(ud, 'config.json'),
  JSON.stringify({
    files: {
      vaultPath: vault,
      openTabs: [join(vault, 'a.md')],
      activeTabPath: join(vault, 'a.md')
    },
    appearance: { theme: 'dark', panelOrientation: 'vertical' }
  })
)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(ELECTRON, [ROOT, `--user-data-dir=${ud}`, `--remote-debugging-port=${PORT}`], {
  stdio: 'ignore',
  env
})

let browser
for (let i = 0; i < 60; i++) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}
const page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage())
await page.waitForFunction(
  () => Boolean(document.querySelector('writemd-app')?.shadowRoot?.querySelector('writemd-editor')),
  { timeout: 30000 }
)
await page.waitForTimeout(1200)

let failures = 0

for (const theme of THEMES) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  await page.waitForTimeout(200)

  const resolved = await page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement)
    const out = {}
    for (const n of names) out[n] = cs.getPropertyValue(n).trim()
    return out
  }, DERIVED)

  const broken = DERIVED.filter((n) => !resolved[n])
  // Probe whether the browser actually accepts the derived values by painting
  // them and reading back. getPropertyValue can echo a token that fails to parse.
  const painted = await page.evaluate((names) => {
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.left = '-9999px'
    document.body.appendChild(probe)
    const out = {}
    for (const n of names) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      probe.style.backgroundColor = ''
      probe.style.backgroundColor = `var(${n})`
      out[n] = getComputedStyle(probe).backgroundColor
    }
    probe.remove()
    return out
  }, DERIVED)

  const unpainted = DERIVED.filter((n) => !painted[n] || painted[n] === 'rgba(0, 0, 0, 0)')

  console.log(`\n${theme}`)
  console.log(`  unresolved tokens: ${broken.length ? broken.join(', ') : 'none'}`)
  console.log(`  failed to paint:   ${unpainted.length ? unpainted.join(', ') : 'none'}`)
  if (broken.length || unpainted.length) failures++

  console.log(
    `  frame=${painted['--bg-frame']}  bg=${painted['--bg']}  raised=${painted['--bg-elevated']}`
  )
  console.log(
    `  ink=${painted['--text']}  dim=${painted['--text-secondary']}  muted=${painted['--text-muted']}`
  )
  console.log(
    `  hover=${painted['--bg-hover']}  active=${painted['--bg-active']}  border=${painted['--border']}`
  )
}

await browser.close()
child.kill()
console.log(`\n${failures === 0 ? 'ALL THEMES OK' : `${failures} THEME(S) WITH UNRESOLVED TOKENS`}`)
process.exit(failures === 0 ? 0 : 1)

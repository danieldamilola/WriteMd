# Release Notes - v1.1.0

**Branch:** `main`
**Date:** 2026-09-24
**Type:** Minor feature + polish

## Overview

v1.1.0 adds Word export, moves the updater into Settings, and rebuilds the main chrome per Figma vertical screens at `node-id=148-127`. The vertical layouts reviewed show a tighter top bar, side tabs, a single top-bar document strip, and a borderless inner panel with flat welcome buttons and soft shadows. This release matches that direction, makes the AI system prompt editable, self-hosts the Geist Mono UI font so it loads offline, and fixes the pnpm build pipeline that blocked `pnpm install` and `pnpm build` on clean clones.

## Highlights

- **Export to Word** - one-click `.docx` from the editor and command palette, using the same HTML as PDF export
- **Updater moved out of the top bar** - manual check and install now live in Settings → About
- **Vertical tabs** - side tab rail replaces top tabs when vertical mode is on, per Figma
- **Single top-bar row** - path, title, mode toggle, and note menu sit in the top bar in vertical mode
- **Editable AI system prompt** - Settings → AI Assistant, full unslop text as default
- **Self-hosted Geist Mono** - UI font bundles with the app, loads offline

## New Features

### Word (.docx) export
- Dependency `package.json:43` `@turbodocx/html-to-docx@^1.22.0` with `pnpm-workspace.yaml:2` `allowBuilds` enabled
- Main `src/main/export.ts:246` `exportDocx()` renders markdown via `markdown-it`, wraps in HTML, converts via `html-to-docx` to OOXML, writes atomically
- IPC `src/main/ipc.ts:286` `export:docx`, preload `src/preload/index.ts:88`, types `src/shared/electron-api.ts:122`
- Renderer `src/renderer/src/components/App.ts:197` and `src/renderer/src/components/Editor.ts:786` `handleExport('docx')`, menu `Editor.ts:977` `Export to Word`, command `src/renderer/src/state/shortcuts.ts:22` `export-docx`
- Save dialog defaults to same name with `.docx`, empty document returns `Document is empty`
- Doc-relative images that stay in the folder embed as data URIs; remote, escaping, and unknown-type assets pass through unchanged

### Vertical tabs (Figma 148-127)
- New `src/renderer/src/components/VerticalTabBar.ts` side rail (196px, 32px tabs) replaces top tabs when `appearance.panelOrientation` is vertical
- Active tab X close matches Figma Vector 6 (8px); fixed invalid nested-button markup and Enter/Space handling so the close button keeps native activation
- Panel collapse toggle beside Settings drawn from Figma Component 29 (rect + divider)

### Document strip in the top bar row
- New self-contained `src/renderer/src/components/DocBar.ts` (parent/file path, renameable title, reading toggle, note menu) driven by FileState directly
- Vertical mode: strip renders compact in the top bar tabs slot as one row (menu, settings, toggle, path, centered title, book, dots, split, window controls); panel holds only the body
- Horizontal mode: strip renders inside the panel as before
- Note menu renders fixed-positioned under the dots button so the top bar `overflow:hidden` slot cannot clip it; DocBar opts out of the window-drag region so clicks land
- Splits stay side-by-side in all modes with horizontal-only resize drag

### Editable AI system prompt
- New `ai.systemPrompt` key in `src/shared/settings-schema.ts` defaulting to the full unslop instruction text (style, file-edit blocks, file tracking)
- Settings → AI Assistant gains a System Prompt textarea with Reset to default; open file context is still appended at runtime
- Fixed assistant acknowledgement is now neutral (`Understood.`) so it cannot reintroduce instructions a custom prompt omits

## Improvements

### Settings → About
- New tab `About` in `src/renderer/src/components/SettingsModal.ts:21` `SettingsTab`, added to sidebar `SettingsModal.ts:913` after AI Assistant
- Content `SettingsModal.ts:1408` `renderAbout()` shows `WriteMd Desktop v{version}` from `window.electronAPI.app.getVersion()` and update state
- Manual flow `SettingsModal.ts:789` `handleCheckForUpdates()`, `SettingsModal.ts:805` `handleDownloadUpdate()`, `SettingsModal.ts:818` `handleInstallUpdate()` wiring `src/preload/index.ts:91` `updater` channels and `src/main/updater.ts:1` `autoUpdater` events `update-available`, `update-not-available`, `update-downloaded`, `download-progress`, `error`
- States: `idle`, `checking`, `available`, `downloading` with percent, `downloaded` with `Restart to update`, `up-to-date`, `error`

### TopBar cleanup
- Removed updater button and auto-check from `src/renderer/src/components/TopBar.ts:65` `updateAvailable`/`downloadingUpdate` and `TopBar.ts:72` `connectedCallback` check, plus `TopBar.ts:168` button. Top bar now only shows menu, settings, split, and window controls.

### Settings footer
- Removed sidebar footer `WriteMd Desktop v1.0.0` at `SettingsModal.ts:925` and its CSS at `SettingsModal.ts:142` `.nav-footer`. Version lives only in About to match Figma vertical screens.

## UI Polish - Figma Vertical Screens (148-127)

Reviewed `https://www.figma.com/design/ctsfPaeg9sQl7OfXhy4eUT/Projects--UI?node-id=148-127&m=dev`. The vertical variants use a 40-43px top bar, compact tabs, and a borderless central panel with flat buttons.

- **TopBar height** `TopBar.ts:16` `56px` → `40px`, padding `12px` → `6px`, window controls margin `-12px` → `-6px`. Editor `src/renderer/src/components/App.ts:39` `.main-area` flex gains 16px vertical space.
- **Tab height** `src/renderer/src/components/Tab.ts:13` `32px` → `26px` so tabs fit cleanly inside the slimmer bar.
- **Inner panel border** `src/renderer/src/components/Panel.ts:22` gradient `::before` removed. Panel stays `background: #141414` `border-radius: 10px` flat.
- **Welcome buttons** `src/renderer/src/components/WelcomeScreen.ts:362` gradient border wrapper `background: linear-gradient(#282828→#000000)` `padding:1px` removed. Buttons keep `background:#161616` `border-radius:4px`.
- **Button shadows** `WelcomeScreen.ts:393` added `box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.25)` and hover `0 2px 4px rgba(0,0,0,0.35), 0 6px 16px rgba(0,0,0,0.3)` for subtle depth.
- **Settings modal height** `SettingsModal.ts:87` `min(620px,88vh)` → `min(700px,90vh)` for more room on vertical screens. Reuses existing `section` `control-btn` `toggle-switch` `scrollbarStyles` primitives, only CSS vars, no new visual patterns.

Note: Figma file requires sign-in to inspect pixel values, so sizes were matched to the existing 43px spec in `PRD.md:159` and the vertical screen proportions, not hard-coded from Figma inspect.

## Fixes

- **Build** `pnpm-workspace.yaml` gains `packages: ['.']` so `pnpm install --frozen-lockfile` passes in CI; `allowBuilds` kept for `@turbodocx/html-to-docx` postinstall. Removed deprecated `package.json` `pnpm.onlyBuiltDependencies` field now handled by `allowBuilds`.
- **PDF margins** `src/main/export.ts` converts mm to inches for `printToPDF` custom margins (previously sent px) and clamps against page size in inches.
- **Fonts** Geist Mono self-hosted (`src/renderer/src/styles/fonts/`, latin + latin-ext woff2 via `@font-face` in `global.css`); dropped from the Google Fonts CDN URL. UI referenced it everywhere but fell back to system monospace offline. Also added to the editor font picker.
- **WelcomeScreen** retains the `appearance.panelOrientation` unsubscribe and releases it on detach.
- **Dev/Preview** `pnpm dev` blank white and `pnpm start` stale `out/` were caused by incomplete install, now `pnpm install` succeeds and `pnpm build` produces `out/main` `out/preload` `out/renderer`.

## Technical

- `vite v7.3.6` builds: `out/main/index.js 39.05kB`, `out/preload/index.js 4.48kB`, bundled GeistMono latin + latin-ext woff2 in `out/renderer/assets`.
- `pnpm 12.3.4` workspace, `electron 39.2.6`, `electron-builder 26.0.12`.
- Security unchanged: `contextIsolation:true`, `nodeIntegration:false`, via `window.electronAPI`.

## Known Issues / Investigating

- `#` heading live preview reported as not styling even in Live/Reading. Parser test `parser.parse('# Roadmap & Future Plans')` gives `ATXHeading1(HeaderMark)` correctly, and `live-decorations.ts:48` `ATXHeading1 → cm-live-h1` with `EditorTheme.ts:72` should hide `#` and enlarge. Suspect mode stuck on Source or frozen preview. Workaround: toggle via sub-header book/pencil icon at `Editor.ts:1225` `handleQuickToggle()` or command palette Quick Toggle, and inspect dev tools for `div.cm-line.cm-live-h1`. If reproducible on `# Hello` in new file, will force Live as default.

## How to Test

```bash
git checkout main
pnpm install
pnpm typecheck
pnpm dev    # live reload, check vertical rail, top-bar strip, Settings AI prompt, fonts
pnpm build  # produce out/
pnpm start  # preview built app
```

Manual checks:
- Settings → Appearance → Vertical tabs on: side rail, top-bar strip, collapse toggle
- Command palette → Export Word, editor … menu → Export to Word (with images)
- Settings → AI Assistant → edit System Prompt, Reset to default
- Settings → About → Check for updates → Download → Restart
- Resize window tall, confirm Figma vertical proportions feel right

## Commits in this release

- `14ff774` feat(export): add Word docx export via html-to-docx, mimic Paperling
- `8e50e18` feat(settings): add About section with manual update check, remove TopBar updater button
- `797e589` fix(settings): remove sidebar footer version
- `afd4a10` fix(settings): increase modal height to 700px/90vh
- `a94853f` fix(ui): reduce TopBar to 40px and tab height to 26px
- `b038e3f` fix(ui): remove inner panel border again per request
- `3e4f627` fix(welcome): remove gradient border from buttons
- `ce7da5e` fix(welcome): add subtle drop shadows to buttons
- `6926ce7` feat(vertical-panel): add toggle in Settings for vertical split layout
- `8252a52` docs: add v1.1.0 release notes
- vertical-panel series: welcome screen layout, auto-open panel, sidebar-first, rail + DocBar + collapse toggle, compact fixes, side-by-side splits
- `96faf5b` fix(fonts): self-host Geist Mono so the UI font actually loads
- `e973254` fix(review): CI workspace, PDF margin units, DOCX images, neutral AI ack, tab keys, welcome unsubscribe
- `74ae898` chore: replace em/en dashes with hyphens project-wide

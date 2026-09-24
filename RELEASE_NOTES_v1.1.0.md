# Release Notes — v1.1.0

**Branch:** `fix/pdf-export` (based on `main` at `d005b4d`)
**Date:** 2026-09-23
**Type:** Minor feature + polish

## Overview

v1.1.0 adds Word export, moves the updater into Settings, and polishes the main chrome per Figma vertical screens at `node-id=148-127`. The vertical layouts reviewed show a tighter top bar, slimmer tabs, and a borderless inner panel with flat welcome buttons and soft shadows. This release matches that direction while fixing the pnpm build pipeline that blocked `pnpm install` and `pnpm build` on clean clones.

## Highlights

- **Export to Word** — one-click `.docx` from the editor and command palette, using the same HTML as PDF export
- **Updater moved out of the top bar** — manual check and install now live in Settings → About
- **Chrome tightening** — TopBar and tabs slimmer so the editor gains vertical space, inner panel and welcome buttons borderless with subtle shadows

## New Features

### Word (.docx) export
- Dependency `package.json:43` `@turbodocx/html-to-docx@^1.22.0` with `pnpm-workspace.yaml:2` `allowBuilds` enabled
- Main `src/main/export.ts:246` `exportDocx()` renders markdown via `markdown-it`, wraps in HTML, converts via `html-to-docx` to OOXML, writes atomically
- IPC `src/main/ipc.ts:286` `export:docx`, preload `src/preload/index.ts:88`, types `src/shared/electron-api.ts:122`
- Renderer `src/renderer/src/components/App.ts:197` and `src/renderer/src/components/Editor.ts:786` `handleExport('docx')`, menu `Editor.ts:977` `Export to Word`, command `src/renderer/src/state/shortcuts.ts:22` `export-docx`
- Save dialog defaults to same name with `.docx`, empty document returns `Document is empty`

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

## UI Polish — Figma Vertical Screens (148-127)

Reviewed `https://www.figma.com/design/ctsfPaeg9sQl7OfXhy4eUT/Projects--UI?node-id=148-127&m=dev`. The vertical variants use a 40-43px top bar, compact tabs, and a borderless central panel with flat buttons.

- **TopBar height** `TopBar.ts:16` `56px` → `40px`, padding `12px` → `6px`, window controls margin `-12px` → `-6px`. Editor `src/renderer/src/components/App.ts:39` `.main-area` flex gains 16px vertical space.
- **Tab height** `src/renderer/src/components/Tab.ts:13` `32px` → `26px` so tabs fit cleanly inside the slimmer bar.
- **Inner panel border** `src/renderer/src/components/Panel.ts:22` gradient `::before` removed. Panel stays `background: #141414` `border-radius: 10px` flat.
- **Welcome buttons** `src/renderer/src/components/WelcomeScreen.ts:362` gradient border wrapper `background: linear-gradient(#282828→#000000)` `padding:1px` removed. Buttons keep `background:#161616` `border-radius:4px`.
- **Button shadows** `WelcomeScreen.ts:393` added `box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.25)` and hover `0 2px 4px rgba(0,0,0,0.35), 0 6px 16px rgba(0,0,0,0.3)` for subtle depth.
- **Settings modal height** `SettingsModal.ts:87` `min(620px,88vh)` → `min(700px,90vh)` for more room on vertical screens. Reuses existing `section` `control-btn` `toggle-switch` `scrollbarStyles` primitives, only CSS vars, no new visual patterns.

Note: Figma file requires sign-in to inspect pixel values, so sizes were matched to the existing 43px spec in `PRD.md:159` and the vertical screen proportions, not hard-coded from Figma inspect.

## Fixes

- **Build** `pnpm-workspace.yaml:2` placeholder `set this to true or false` → `true` for `@turbodocx/html-to-docx`, fixes `ERR_PNPM_IGNORED_BUILDS` and postinstall `node scripts/postinstall.js`. Removed deprecated `package.json:67` `pnpm.onlyBuiltDependencies` field now handled by `allowBuilds`.
- **PDF margins** `src/main/export.ts:163` clamp margins per page size and handle `NaN`, from `462cdd1`.
- **Dev/Preview** `pnpm dev` blank white and `pnpm start` stale `out/` were caused by incomplete install, now `pnpm install` succeeds and `pnpm build` produces `out/main` `out/preload` `out/renderer`.

## Technical

- `vite v7.3.6` builds: `out/main/index.js 37.49kB`, `out/preload/index.js 4.59kB`, `out/renderer` 2326 modules.
- `pnpm 12.3.4` workspace, `electron 39.2.6`, `electron-builder 26.0.12`.
- Security unchanged: `contextIsolation:true`, `nodeIntegration:false`, via `window.electronAPI`.

## Known Issues / Investigating

- `#` heading live preview reported as not styling even in Live/Reading. Parser test `parser.parse('# Roadmap & Future Plans')` gives `ATXHeading1(HeaderMark)` correctly, and `live-decorations.ts:48` `ATXHeading1 → cm-live-h1` with `EditorTheme.ts:72` should hide `#` and enlarge. Suspect mode stuck on Source or frozen preview. Workaround: toggle via sub-header book/pencil icon at `Editor.ts:1225` `handleQuickToggle()` or command palette Quick Toggle, and inspect dev tools for `div.cm-line.cm-live-h1`. If reproducible on `# Hello` in new file, will force Live as default.

## How to Test

```bash
git checkout fix/pdf-export
pnpm install
pnpm typecheck
pnpm dev    # live reload, check Welcome buttons shadows, Settings → About → Check for updates, TopBar height, Tab height, heading
pnpm build  # produce out/
pnpm start  # preview built app
```

Manual checks:
- Command palette → Export Word, editor … menu → Export to Word
- Settings → About → Check for updates → Download → Restart
- Resize window tall, confirm Figma vertical proportions feel right

## Commits in this release

- `19d0cb2` fix(build): allow html-to-docx build, remove deprecated pnpm field
- `14ff774` feat(export): add Word docx export via html-to-docx, mimic Paperling
- `8e50e18` feat(settings): add About section with manual update check, remove TopBar updater button
- `797e589` fix(settings): remove sidebar footer version
- `afd4a10` fix(settings): increase modal height to 700px/90vh
- `a94853f` fix(ui): reduce TopBar to 40px and tab height to 26px
- `b038e3f` fix(ui): remove inner panel border again per request
- `3e4f627` fix(welcome): remove gradient border from buttons
- `ce7da5e` fix(welcome): add subtle drop shadows to buttons

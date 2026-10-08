# Workspace UI repair

The review documents describe the original failures. This document records the replacement boundaries and their verification without changing the existing editor engine or the tab design.

| Original failure                                    | Repair                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| Unpin changed array indices and moved the wrong tab | Stable-ID `dropTab` transaction; removal precedes neighbor resolution       |
| Cancellation committed an order change              | Canceled library gestures never call the transaction                        |
| Insertion gap confused with a final array index     | Explicit before/after neighbor IDs                                          |
| Drag autoscroll stopped or was undone by render     | Library AutoScroller; selection reveal skips active gestures                |
| Two panes overflowed narrow windows                 | Measured allocation, derived pixel limits, compact surface selection        |
| Removed Electron `File.path` broke OS drops         | Preload `getPathForFile` plus dropped-path registration                     |
| Rail fade held width and then jumped                | Motion animates the rail's allocated width and retargets on toggles         |
| Reset left orientation/motion stale                 | Every registered settings subscription is notified                          |
| Focus, inertness, and menus differed by screen      | Web Awesome adapters, native dialogs, popup placement, menu keyboard policy |
| Remote font stylesheet conflicted with CSP          | Bundled fonts; stylesheet reference removed                                 |

`Editor` still owns its CodeMirror views, extension configuration, and document replacement. Workspace sizing belongs to `Workspace`/`WorkspaceState`; AI business state belongs to `AiSessionController`; tab gestures belong to `TabDragController`. The shell consumes a metadata selector instead of rerendering on each document edit. No second global state framework was introduced.

Background images are copied into application-owned storage and represented by validated IDs. Effects run outside the renderer's UI thread, with cached results invalidated on image replacement. CSS surface transparency and system window material remain independent controls.

The background settings card and compact surface selector follow existing design tokens and the supplied reference. Figma does not yet define those controls; they should be added there before further visual changes.

Validation evidence is saved under `artifacts/ui-review/`: background settings/workspace, drag preview, compact workspace, resizable split, and rail screenshots. Tests use isolated temporary profiles and vaults. Native material runtime verification is on Windows; macOS vibrancy and unsupported-platform behavior also have explicit code paths.

The final Electron run passes all 42 selected cases, including existing AI, editor, find/replace, settings, conflict, and split-save regressions. New coverage includes copied image storage and removal, all image effects, restart persistence, cancellation in both tab orientations, continuous edge scrolling, divider keyboard changes, rail allocation, and nested dialog dismissal. Active-tab visibility tests cover nested tab wrappers through viewport-relative measurements.

Final checks:

- `pnpm typecheck`: passed for main, renderer, and tests.
- `pnpm test --maxWorkers=2`: 650 tests passed across 59 files.
- ESLint on changed/new TypeScript files: passed with no errors or warnings.
- `pnpm build`: passed; existing dynamic/static import bundling warnings remain.
- Selected Playwright Electron suite: 42 tests passed across 12 specs. `artifacts/ui-review/e2e-verified.log` records the run.

Screenshots: [background controls](screenshots/ui-v1.4.0/fixed-background-settings.png), [workspace image](screenshots/ui-v1.4.0/fixed-background-workspace.png), [drag preview](screenshots/ui-v1.4.0/fixed-drag.png), [compact workspace](screenshots/ui-v1.4.0/fixed-compact.png), [resized split](screenshots/ui-v1.4.0/fixed-workspace.png), [rail](screenshots/ui-v1.4.0/fixed-rail.png).

## Flat workspace and settings follow-up

The requested experiment removes pane rounding and the editor's 5px outer gutter. Pane resizing retains its existing hit area and keyboard behavior, with a faint 1px visual divider. Pinned tabs keep spacing between sections without a separator rule.

Settings now use a centered, viewport-constrained 980px by 600px dialog, 200px navigation, and independently scrolling content. Sidebar, footer, section, and row rules are removed. One close button replaces the duplicate minimize/maximize/window-close controls. The legacy appearance preference keeps classic dialog proportions. Active categories expose their selection to assistive technology.

OpenCode references: [settings dialog composition](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/components/dialog-settings.tsx), [dialog sizing](https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/components/dialog.css), and [settings navigation](https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/components/tabs.css). WriteMd adapts these proportions and navigation patterns through its existing Lit/Web Awesome components and theme tokens. The removal of lines is the user's requested variation.

MonoCode references were read from the adjacent repository: `C:/dev/monocode/src/app/App.tsx`, `src/features/sessions/ui/SessionPane.tsx`, `src/styles/index.css`, `src/features/projects/ui/ProjectBackgroundDialog.tsx`, and `src/features/projects/ui/useProjectBackgroundEffect.ts`. MonoCode renders pane-local artwork beneath content, uses separate empty/session visibility, and separates native glass from artwork. WriteMd now follows that layering: workspace artwork is inside each panel, rather than behind translucent panels and the tab rail. Import leaves surface opacity unchanged. Settings can preview empty/content strength and respect empty-only scope. Haze adds a downward fade; reduced motion disables visibility transitions.

This deliberately changes the original Figma frame at the user's request. The flat workspace and settings presentation need formalizing in Figma; existing tab styling and CodeMirror behavior remain in place.

Follow-up checks: build/typecheck passed, 127 relevant unit tests passed across seven files, and ESLint passed on all touched TypeScript files. The 25-case Electron layout suite passed; seven existing AI cases and the expanded background case also passed after correcting auxiliary-pane empty/content state. Together they cover 32 distinct cases. Coverage checks settings centering in both tab layouts, classic proportions, edge-to-edge pane bounds, modal focus and nested dismissal, settings search, dragging, resizing, split saves, all background effects, scope, preview strength, restart persistence, and AI streaming/cancellation. Logs are `flat-build.log`, `flat-unit.log`, `flat-lint.log`, `flat-lint-final.log`, `flat-e2e.log`, and `flat-ai-background.log` under `artifacts/ui-review`.

Screenshots: [flat workspace](screenshots/ui-v1.4.0/flat-workspace-horizontal.png), [vertical tabs](screenshots/ui-v1.4.0/flat-workspace-vertical.png), [settings](screenshots/ui-v1.4.0/flat-settings-general.png), [settings over vertical tabs](screenshots/ui-v1.4.0/flat-settings-vertical.png), and [pane-local wallpaper](screenshots/ui-v1.4.0/fixed-background-workspace.png).

## Toolbar surface follow-up

The transparent toolbar exposed the darker application frame rather than the editor surface. `TopBar` and `Panel` now share `--editor-surface`, derived from the theme and surface opacity, and use the same blur preference. The toolbar has no bottom rule; the window control box retains the frame surface and its left and bottom rules. The previously removed Menu, Settings, and panel icons remain absent. This follows the requested chrome treatment and needs formalizing in Figma.

Validation: `pnpm build` passed, including all three typechecks; `pnpm test --maxWorkers=2` passed 673 tests across 62 files; ESLint passed for the touched TypeScript files. The Electron suite passed 11 cases across sidebar, icons, and settings layout specs. The toolbar case compares actual computed editor/toolbar colors across Graphite, Light, and Paper, both tab orientations, and 100%/65% surface opacity, and checks the window box borders and removed icons.

Screenshots inspected: [Graphite with vertical tabs](screenshots/ui-v1.4.0/toolbar-graphite-vertical.png) and [Light with horizontal tabs](screenshots/ui-v1.4.0/toolbar-light-horizontal.png).

## Settings sidebar follow-up

Settings search now lives in the sidebar, using the same search component and 8px horizontal/12px top inset as the document sidebar. Search events go directly to settings; the title-bar search and its forwarding methods are removed. Opening settings focuses the input through its Shadow DOM. The settings header starts beside the sidebar in either tab layout, preventing it from covering search in horizontal mode.

Writing groups New notes, Editor, and Files & vault. Workspace groups Appearance and Keyboard shortcuts. Application groups AI Assistant, Advanced, and About WriteMd. Shared chrome icons, 34px minimum row heights, 4px gaps within groups, and 24px gaps between groups replace the cramped navigation. Back to editor remains at the bottom. Labels and group membership come from the settings search module. Exact category names take priority over incidental row keywords, so New notes opens its own settings rather than release notes. Clearing search restores all groups.

The layout follows the user's supplied sidebar reference and existing WriteMd primitives. It needs formalizing in Figma. Validation: `pnpm build` passed, including all typechecks; 103 relevant unit tests passed across five files; ESLint and formatting checks passed. All 20 Electron tests passed across editor, icons, settings layout/search, and sidebar specs. Checks cover actual search clicks in both layouts and themes, keyboard match navigation, renamed categories, focus restoration, and navigation at 800px by 650px.

Screenshots inspected: [Graphite](screenshots/ui-v1.4.0/settings-sidebar-graphite-vertical.png), [Light](screenshots/ui-v1.4.0/settings-sidebar-light-horizontal.png), and [compact window](screenshots/ui-v1.4.0/settings-sidebar-compact.png).

## Settings consistency follow-up

Settings cards now share responsive padding, readable descriptions, and consistent control heights. Rows and action groups wrap without overflowing; font cards use an adaptive grid. All fixed settings choices use themed Web Awesome dropdowns with accessible labels, keyboard selection, and Escape handling. Dropdowns open and close immediately to avoid the library's animation race when reopening after a selection.

Inter, Manrope, DM Sans, Space Grotesk, JetBrains Mono, and Geist Mono load locally. Removed font choices migrate to Manrope while preserving font size and other preferences. The New Design beta card, its preference, and obsolete classic-layout styling are removed. Monochrome switches derive their track and thumb from contrasting theme surfaces; colored accents choose a readable foreground. Description contrast is checked across all seven themes.

The compact document toolbar shows the path again, with the full path on hover. Floating counts use larger, readable text and an accessible mode button. Sidebar and workspace dividers expose three-dot handles while retaining pointer and keyboard resizing. The caption buttons share the editor surface without their former dark box or borders; the sidebar keeps the secondary theme surface.

These changes follow the user's screenshots and requested refinements using existing WriteMd primitives. The revised settings and chrome treatment need formalizing in Figma.

Validation: the full unit suite passed 675 tests across 62 files using one worker. An earlier concurrent run hit a timing benchmark and worker-start timeouts; the isolated full run passed without changing benchmark limits. `pnpm build` passed, including all three typechecks; ESLint and formatting checks passed. The build log is `artifacts/ui-review/refined-build.log`.

All 54 selected Electron tests passed across nine specs. They cover every settings category in seven themes at 800px and 1200px, description and switch contrast, dropdown selection/reopening/keyboard/Escape/persistence, local fonts, path and mode/count visibility in both tab layouts, borderless caption controls, three-dot resize handles, drag cancellation, narrow-window allocation, background effects and restart persistence, window material selection, and nested dialog focus. The log is `artifacts/ui-review/refined-e2e.log`. Final screenshots were inspected, including the fully opaque dropdown.

Screenshots: [compact settings](screenshots/ui-v1.4.0/refined-appearance-graphite-800.png), [light settings](screenshots/ui-v1.4.0/refined-appearance-light-1200.png), [fonts](screenshots/ui-v1.4.0/refined-fonts.png), [dropdown](screenshots/ui-v1.4.0/refined-dropdown.png), [shortcut spacing](screenshots/ui-v1.4.0/refined-shortcuts.png), and [visible path and counts](screenshots/ui-v1.4.0/refined-workspace-vertical.png).

## Document header and menu correction

The toolbar and panel had identical CSS colors, but the workspace painted another translucent surface behind the panel. Reduced opacity therefore produced different rendered colors. The workspace now stays transparent; only its exposed resize gutter paints the shared editor surface. Regression checks compare actual screenshot pixels across Graphite, Light, and Paper, both tab layouts, and 100%/65% opacity.

The compact header previously gave the path and title equal flex space while excluding caption controls from its width. The document strip now spans the full header, uses equal grid columns, and reserves room for window actions. The title and rename field center on the whole header at compact and wide sizes. Caption widths use a shared token.

The document menu assumed a 230px width while rendering wider contents, and fixed positioning inherited the toolbar's containing block. It now uses the existing context-menu adapter anchored to the actual button, with end alignment, viewport edge padding, measured width, and height constraints. Keyboard navigation and Escape/focus restoration come from the shared adapter. Short windows scroll the menu instead of clipping its actions.

The correction follows the user's screenshots, the Figma title treatment, and existing WriteMd menu/theme primitives. The full-header alignment and menu placement should be formalized in Figma.

`pnpm build` passed with all typechecks; ESLint and formatting checks passed. All three new Electron regressions passed, and final screenshots were inspected. The broader run passed 33 of 34 cases; one existing pinned-tab drag test missed gesture activation. All eight workspace cases passed on an isolated recheck without changing drag code or test expectations, covering all 34 distinct Electron cases. The recheck is recorded in `artifacts/ui-review/document-chrome-workspace-recheck.log`. Other logs are `document-chrome-build.log` and `document-chrome-e2e.log` in the same directory.

The 44 relevant unit tests passed across four files. Their log is `artifacts/ui-review/document-chrome-unit.log`.

Screenshots: [centered compact title](screenshots/ui-v1.4.0/document-centered-vertical-800.png), [matched surfaces](screenshots/ui-v1.4.0/document-surface-graphite.png), [complete menu](screenshots/ui-v1.4.0/document-menu-vertical-650.png), and [short-window menu](screenshots/ui-v1.4.0/document-menu-horizontal-420.png).

## Pane menus, pinned separator, and sidebar updates

The secondary document now uses the shared document header with its own reading toggle, menu, and close action. Mode, rename, move, export, and find target that pane. Find retains its pane when the search input takes focus. Renaming or moving a shared file updates every matching open document, file watchers, persisted paths, and subsequent save targets without overwriting intervening edits. Diff review keeps its dedicated header, using the UI font without a bottom rule; obsolete duplicate rename styles and handlers are removed.

Document and text menus now dismiss one another through the renderer event bus. Text menus live outside the filtered panels, use measured viewport-constrained popups for the main menu and submenus, and render SVG chevrons instead of the corrupted text glyph. Keyboard focus waits until the popup opens; arrow keys enter and leave submenus. Opening another menu or clicking elsewhere preserves the destination's focus.

A centered 48px by 1px theme-colored line separates pinned/grouped documents from unpinned documents when both sections exist. Vertical tabs show the update action above AI Assistant: Update available, download percentage, and Restart to update. The same typed updater bridge handles download and installation; horizontal tabs retain their existing toolbar control. These changes follow the user's screenshots and existing WriteMd primitives and need formalizing in Figma.

Screenshots: [secondary document menu](screenshots/ui-v1.4.0/secondary-document-menu.png), [text submenu at the viewport edge](screenshots/ui-v1.4.0/text-menu-viewport.png), [pinned separator](screenshots/ui-v1.4.0/pinned-tab-separator.png), and [update ready above AI Assistant](screenshots/ui-v1.4.0/sidebar-update-ready.png).

Validation: `pnpm build` passed with all three typechecks; ESLint and formatting checks passed. All 83 relevant unit tests passed across seven files. The broader Electron run passed all 30 cases across seven specs, covering menu bounds, header surfaces/alignment, split saving, conflicts, find, dragging, resizing, backgrounds, and modal focus. The final seven-case recheck passed against the final build, including corrected click-coordinate assertions and keyboard submenu focus. Updater download and installation calls were intercepted in the isolated test profile. Screenshots were inspected. Logs are `pane-menu-build.log`, `pane-menu-unit.log`, `pane-menu-lint.log`, `pane-menu-lint-final.log`, `pane-menu-format-check.log`, `pane-menu-electron.log`, and `pane-menu-final-electron.log` under `artifacts/ui-review`.

## Welcome screen follow-up

The welcome screen previously bypassed `Shell`, with its own toolbar, caption buttons, rounded inner frame, fixed columns, and watermark. Home now occupies the same content slot as the editor. The existing sidebar and captions stay mounted when notes open or close, and settings use the same embedded page. Vertical mode remains the default while explicit horizontal preferences are respected.

Home presents WriteMd, New note/Open file actions, four recent notes with short paths and full-path tooltips, and vault access. Native buttons handle keyboard activation; shortcut hints follow configured bindings. Recent-note subscriptions refresh the page and discard older vault responses. Home uses the shared empty panel, so image effects, empty-view strength, and target/scope work through the existing background store. The sidebar identifies Home and exposes vault access; AI requires an open note. Shared components replace duplicated welcome window controls, SVGs, and layout subscriptions. File opening leaves welcome visibility to the file-state subscription, retaining home when a picker is canceled or opening fails.

The original Figma welcome frame was inspected. The flat layout and vertical sidebar adapt its recent-file and new/open/vault actions to the user's current WriteMd design; this replacement needs formalizing in Figma.

Validation: build and all three typechecks passed; ESLint and formatting checks passed. All 35 relevant unit tests passed across four files, including recent-note subscriptions, stale response cancellation, and shortcut hints. The 28-case Electron suite passed across seven specs. Home checks cover seven themes in both orientations at 800px and 1200px, a scrolling 420px-tall window, native keyboard actions, home/editor transitions with preserved sidebar identity, file-picker cancellation, vault bridge calls, settings/search, empty vaults, and image background scope/strength. The additional failed-file-read regression passed on recheck. Screenshots were inspected. Logs are `welcome-build.log`, `welcome-typecheck.log`, `welcome-unit.log`, `welcome-lint.log`, `welcome-lint-final.log`, `welcome-format.log`, `welcome-electron.log`, and `welcome-file-recheck.log` under `artifacts/ui-review`.

Screenshots: [default vertical home](screenshots/ui-v1.4.0/welcome-vertical-graphite.png), [compact light home](screenshots/ui-v1.4.0/welcome-vertical-light-800.png), [horizontal Paper theme](screenshots/ui-v1.4.0/welcome-horizontal-paper-800.png), [short window](screenshots/ui-v1.4.0/welcome-short-window.png), [empty vault](screenshots/ui-v1.4.0/welcome-empty-vault.png), and [image background](screenshots/ui-v1.4.0/welcome-image-background.png).

## v1.4.0 release validation

The package version is 1.4.0. [Release notes](release-notes/RELEASE_NOTES_v1.4.0.md) describe the final workspace, settings, and home behavior and the one-time orientation/font migrations.

- `pnpm build` passed, including main, renderer, and test typechecks.
- `pnpm test --maxWorkers=1` passed all 685 unit tests across 63 files.
- `pnpm exec playwright test --workers=1` passed all 118 Electron tests across 23 specs.
- Repository ESLint, Prettier, and staged whitespace checks passed.

The Electron run covers the final home, settings, split menus, backgrounds, drag/resize behavior, AI panel, conflicts, table editing, and large-document regressions. Updater calls are intercepted; local visual and native-material verification is on Windows.

The 35 linked screenshots are preserved in `docs/screenshots/ui-v1.4.0/` for PR review. Logs and reference snapshots remain local under `artifacts/ui-review/`. A screenshot-only scratch spec was moved out of the regression suite. MonoCode and OpenCode license notices now accompany the packaged application.

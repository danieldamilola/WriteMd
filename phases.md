# Phases — WriteMD Implementation Roadmap

## Phase 1: Foundation (Week 1-2)

**Goal:** Runnable Electron app with themed shell matching Figma layout, vault setup, file associations.

| Task                  | Details                                                                     | Acceptance                 |
| --------------------- | --------------------------------------------------------------------------- | -------------------------- |
| 1.1 Repo init         | `pnpm init`, TypeScript strict, ESLint, Prettier, Vitest                    | `pnpm typecheck` passes    |
| 1.2 Electron + Vite   | Main/Renderer split, HMR, preload (contextBridge)                           | `pnpm dev` opens window    |
| 1.3 Frameless window  | Unified TopBar (menu, settings, tabs, split toggle, min/max/close controls) | Native feel                |
| 1.4 Component Library | Reusable primitives: Button, IconButton, Tab, Panel, TopBar, ModeToggle     | Matches Figma specs        |
| 1.5 Theme system      | CSS variables for themes (Light, Dark, Paper, etc.), persisted              | Theme switcher works       |
| 1.6 Settings store    | IndexedDB + `config.json` sync, schema from PRD §10                         | Persists across restarts   |
| 1.7 Vault setup       | First-run prompt → `~/Documents/WriteMD/` (configurable), create dir, watch | Vault ready for new files  |
| 1.8 File associations | Register `.md/.markdown/.mdown/.mkd` on install (NSIS/dmg/AppImage)         | Double-click opens WriteMD |

---

## Phase 2: Editor Core (Week 3-5)

**Goal:** CodeMirror 6 WYSIWYG editor with Live Preview, floating mode toggle, shortcuts, split view.

| Task                         | Details                                                                  | Acceptance                         |
| ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| 2.1 CM6 integration          | `EditorView` inside `<writemd-panel>`, Lezer markdown parser             | Editor renders markdown            |
| 2.2 Syntax highlighting      | Lezer-based tokens, CSS variables from theme                             | Colors match theme                 |
| 2.3 Live Preview decorations | Widget decorations replace syntax with rendered DOM (images, math, etc.) | WYSIWYG default mode               |
| 2.4 Mode toggle component    | Floating pill (`<writemd-mode-toggle>`): Live, Source, Split             | Smooth transitions, `Ctrl+Shift+E` |
| 2.5 Keyboard shortcuts       | All shortcuts from PRD §8                                                | Shortcuts work in editor           |
| 2.6 Split view               | Multi-pane `<writemd-panel>` sharing `EditorState`                       | Synced scroll, independent modes   |
| 2.7 Placeholder/empty        | "Start writing..." when doc empty                                        | Friendly empty state               |

---

## Phase 3: File & Image Handling (Week 6)

**Goal:** Open/save any file, auto-save, recent files, images, vault explorer.

| Task                       | Details                                                                    | Acceptance           |
| -------------------------- | -------------------------------------------------------------------------- | -------------------- |
| 3.1 Open dialog            | `Ctrl+O` → native picker, reads file, sets `filePath`                      | Opens external files |
| 3.2 Drag-drop files        | Drop on window/toolbar → open                                              | Works                |
| 3.3 Auto-save              | Debounced 500ms, atomic write (temp → rename), respects `filePath`         | No data loss         |
| 3.4 Dirty tracking         | Titlebar dot, `Ctrl+S` forces save, close prompts if dirty                 | Standard behavior    |
| 3.5 Recent files           | IndexedDB (10 max), sidebar + welcome screen, distinguishes vault/external | Persists             |
| 3.6 Image paste/drop       | Clipboard/files → `{dir}/_assets/{uuid}.ext`, inserts relative markdown    | Images appear inline |
| 3.7 Image resize           | Click image → drag handles, writes `width="..."` attribute                 | Visual resize works  |
| 3.8 Vault sidebar          | FileExplorer component shows vault tree, click → open, context menu        | Quick vault access   |
| 3.9 External change detect | `fs.watch` → diff dialog (original/current/disk)                           | No silent overwrites |

---

## Phase 4: Advanced Editing (Week 7-8)

**Goal:** Tables, code blocks, math, Mermaid, find/replace, frontmatter.

| Task                      | Details                                                             | Acceptance             |
| ------------------------- | ------------------------------------------------------------------- | ---------------------- |
| 4.1 Tables                | Insert (toolbar/slash), add/rm row/col, align, keyboard nav         | Full GFM table editing |
| 4.2 Code blocks           | Language picker, line numbers toggle, copy button, Prism highlight  | Dev-friendly           |
| 4.3 Math (KaTeX)          | Inline `$...$`, block `$$...$$`, copy LaTeX button, lazy-load KaTeX | Renders correctly      |
| 4.4 Mermaid               | Fenced `mermaid` → render on demand, toolbar button                 | Diagrams work          |
| 4.5 Find/Replace          | `Ctrl+F` / `Ctrl+H`, regex, case-sensitive, match count             | Standard find bar      |
| 4.6 Frontmatter           | `---` block at top, collapsible, YAML editor (key/value)            | Metadata editing       |
| 4.7 Task lists            | Clickable `- [ ]` / `- [x]` in WYSIWYG                              | Interactive            |
| 4.8 Wiki-links (optional) | `[[page]]` autocomplete from vault sibling files                    | Obsidian-compat        |

---

## Phase 5: Export & Polish (Week 9)

**Goal:** PDF/HTML export, settings modal, welcome screen, command palette.

| Task                       | Details                                                                     | Acceptance              |
| -------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| 5.1 PDF export             | Puppeteer/print-to-PDF, options: margin, page size, theme                   | Styled PDF output       |
| 5.2 HTML export            | Standalone HTML with embedded CSS, theme-aware                              | Portable HTML           |
| 5.3 Settings modal         | Tabs: General, Editor, Appearance, Shortcuts, Advanced — all PRD §10 fields | Full config UI          |
| 5.4 Welcome screen         | Recent files, New File (vault), Open File, Open Vault Folder                | First-run + empty state |
| 5.5 Command palette        | `Ctrl+P`, fuzzy search commands, shortcuts shown                            | Power-user nav          |
| 5.6 Shortcut customization | Settings → Shortcuts, edit bindings, conflict detection                     | User-defined keys       |
| 5.7 About / Cheatsheet     | Menu items, version, license, keyboard reference                            | Standard desktop app    |

---

## Phase 6: Release Prep (Week 10)

**Goal:** Signed installers, auto-update, docs, v1.0.

| Task              | Details                                                             | Acceptance             |
| ----------------- | ------------------------------------------------------------------- | ---------------------- |
| 6.1 Code signing  | Windows (EV cert), macOS (notarization), Linux (AppImage)           | No warnings            |
| 6.2 Auto-updater  | GitHub Releases, silent check, restart banner                       | Seamless updates       |
| 6.3 CI/CD         | GitHub Actions: lint, typecheck, test, build matrix (win/mac/linux) | Green on main          |
| 6.4 E2E tests     | Playwright: open, edit, save, export, settings, vault               | Critical paths covered |
| 6.5 Documentation | README, keyboard shortcuts, vault concept, FAQ                      | User-ready             |
| 6.6 Beta test     | Internal + 5 external testers, collect bugs                         | Sign-off               |
| 6.7 v1.0 release  | Tag, GitHub Release, announcement                                   | Ship it                |

---

## Parallel Tracks (Ongoing)

| Track              | Activities                                                           |
| ------------------ | -------------------------------------------------------------------- |
| **Design sync**    | Weekly Figma review — implement new frames, update components        |
| **Performance**    | Profile startup, memory, typing latency — keep under PRD §13 targets |
| **Accessibility**  | ARIA labels, keyboard nav, focus management, screen reader test      |
| **Cross-platform** | Test on Windows 10/11, macOS 13+/14+, Ubuntu 22.04+                  |

---

## Definition of Done (Per Task)

- [ ] TypeScript strict: no `any`, no `@ts-ignore`
- [ ] Lint: `pnpm lint` passes
- [ ] Tests: unit + integration for new logic
- [ ] Manual verify: matches Figma (or design philosophy if frame missing)
- [ ] No console errors/warnings
- [ ] Settings persist, survive restart
- [ ] Works in all three themes (Light/Dark/Paper minimum)

---

## Design Decision Protocol

**If Figma frame exists:** Implement pixel-perfect (spacing, colors, radius, transitions from CSS variables).

**If Figma frame missing:**

1. Check Figma for similar patterns (buttons, dialogs, toolbars)
2. Follow project design philosophy: clean, native-feeling, keyboard-first, minimal chrome
3. Use existing component primitives (Button, Input, Dropdown, Modal, Tooltip)
4. Document decision in PRD §16 appendix
5. Flag for design review in next sync

**Never:** Invent new patterns, use non-CSS-variable colors, add framework dependencies, skip accessibility.

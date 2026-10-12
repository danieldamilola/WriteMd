# PRD: WriteMd - Frictionless Markdown Editor

## 1. Product Vision

**WriteMd** is a local-first markdown editor that opens **any `.md` file directly** - no vault, no import, no copy-paste. Double-click a file, edit in a beautiful WYSIWYG interface, save. Done.

**Core philosophy:** "Open → Edit → Save". Zero friction. Zero setup.

**Target user:** Writers, developers, students who just want to edit markdown files scattered across their filesystem without managing a "vault" or "workspace."

---

## 2. Problem Statement

| Current Tool           | Pain Point                                                                      |
| ---------------------- | ------------------------------------------------------------------------------- |
| **Obsidian**           | Forces vault structure; can't open arbitrary `.md` files without moving/copying |
| **Paperling**          | Poor UI/UX; source-mode first; not polished                                     |
| **VS Code**            | Overkill; developer-centric; no true WYSIWYG                                    |
| **Typora / iA Writer** | Good but paid/closed; limited extensibility                                     |
| **Online editors**     | Not local-first; privacy concerns                                               |

**Gap:** No editor combines: (1) open any file anywhere, (2) WYSIWYG-first editing, (3) beautiful native-feeling UI, (4) free & open.

---

## 3. User Stories

### MVP (Must Have)

- [x] **US-001** Double-click any `.md` file → opens in WriteMd immediately
- [x] **US-002** Drag-drop `.md` file onto app window → opens
- [x] **US-003** WYSIWYG editing: bold, italic, headings, lists, quotes, code, links, images
- [x] **US-004** Live Preview toggle (WYSIWYG ↔ Source) with `Ctrl+E`
- [x] **US-005** Auto-save on change (debounced 500ms) + manual `Ctrl+S`
- [x] **US-006** Syntax highlighting in source mode (CodeMirror 6)
- [x] **US-007** Paste/drag-drop images → auto-save to `_assets/` folder next to file
- [ ] **US-008** Resize images inline (drag handles)
- [x] **US-009** Tables: insert, add/remove rows/cols, align
- [ ] **US-010** Fenced code blocks with language detection + syntax highlight
- [x] **US-011** Math: inline `$...$` and block `$$...$$` (KaTeX)
- [x] **US-012** Export to PDF (styled) and HTML
- [x] **US-013** Recent files list (persisted, 10 items)
- [ ] **US-014** Keyboard shortcuts for all formatting (Markdown standard)

### Post-MVP (Nice to Have)

- [x] **US-020** Split view (editor + preview side by side)
- [ ] **US-021** Vim mode toggle
- [ ] **US-022** Typewriter mode (focus line centered)
- [x] **US-023** Themes: Light, Dark, Paper, Dracula, Nord
- [ ] **US-024** Custom CSS injection (user styles)
- [x] **US-025** Command palette (`Ctrl+P`)
- [x] **US-026** Find/Replace in file (`Ctrl+F` / `Ctrl+H`)
- [~] **US-027** Word count in the document info pill. Words and characters
  ship in `InfoPill.ts`. Reading time is not implemented.
- [ ] **US-028** Frontmatter editor (YAML). A `frontmatter-plugin.ts` exists for
      parsing; there is no editing UI.
- [x] **US-029** Mermaid diagram rendering
- [ ] **US-030** Wiki-links `[[...]]` autocomplete (sibling files)
- [ ] **US-031** Portable mode (config in app folder)
- [x] **US-032** File association handler (set as default `.md` opener)

Theme count: seven ship (`dark`, `graphite`, `midnight`, `light`, `paper`,
`dracula`, `nord`), not the five listed in US-023.

> Note: callouts. The note menu has a Callout item that inserts `> [!note]`
> (`TextMenu.ts:388`), but nothing parses or renders that syntax. It displays as
> a plain blockquote.

---

## 4. Technical Architecture

### 4.1 Platform Decision: **Electron + TypeScript** (like Obsidian)

**Why Electron over Tauri?**

- Obsidian proves Electron can be fast/lightweight with careful engineering
- Mature ecosystem for: file associations, native menus, system tray, auto-updater
- CodeMirror 6 + Electron = proven combo (Obsidian, many others)
- Easier to hire/contribute; larger talent pool
- Webview2 on Windows is now stable and performant

**Bundle size target:** < 80 MB installed (Obsidian ~100 MB)

### 4.2 Tech Stack

| Layer                | Technology                                                          | Rationale                                                |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| **Shell**            | Electron 44                                                         | Native menus, file dialogs, associations                 |
| **Language**         | TypeScript 5+ (strict mode)                                         | Type safety, Obsidian-compatible plugin types            |
| **Editor**           | CodeMirror 6 + @codemirror/lang-markdown                            | Live Preview, decorations, incremental parsing           |
| **Markdown Parse**   | markdown-it (preview) + Lezer (editor)                              | Proven, extensible, spec-compliant                       |
| **Syntax Highlight** | @codemirror/language (Lezer, editor) + custom highlighter (preview) | One highlight pipeline per surface                       |
| **Math**             | KaTeX (fast, no MathJax bloat)                                      | Client-side rendering                                    |
| **Diagrams**         | Mermaid.js (lazy-loaded)                                            | Optional, on-demand                                      |
| **Styling**          | CSS Custom Properties + PostCSS                                     | Themeable, no runtime CSS-in-JS                          |
| **UI Framework**     | TypeScript + Lit Web Components                                     | Preserve existing editor and WriteMd styling             |
| **UI Primitives**    | Web Awesome 3, behind WriteMd adapters                              | Dialog focus, popup placement, split panels, sliders     |
| **Interactions**     | @dnd-kit/dom 0.5 + Motion                                           | Shared gesture lifecycle and interruptible motion        |
| **State**            | FileState and SettingsStore singletons with subscriptions/selectors | One owner per state; document typing skips shell renders |
| **Build**            | Vite + electron-builder                                             | Fast dev, optimized production                           |
| **Testing**          | Vitest + Playwright (E2E)                                           | Unit + integration                                       |

### 4.3 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main Process                   │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Window  │ │ File     │ │ Menu/    │ │ Auto-Updater   │  │
│  │ Manager │ │ Watcher  │ │ Tray     │ │ (electron-updater)│
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └───────┬────────┘  │
└───────┼────────────┼────────────┼──────────────┼───────────┘
        │            │            │              │
        ▼            ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (UI)                     │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐  │
│  │  App Shell   │ │  Editor Core │ │   Preview Engine   │  │
│  │  (layout,    │ │  (CodeMirror │ │   (markdown-it +   │  │
│  │   toolbar,   │ │   6 + CM     │ │    KaTeX + Mermaid)│  │
│  │   statusbar) │ │   extensions)│ │                    │  │
│  └──────┬───────┘ └──────┬───────┘ └─────────┬──────────┘  │
│         │                │                   │             │
│         └────────────────┼───────────────────┘             │
│                          ▼                                 │
│              ┌─────────────────────┐                       │
│              │   Shared State      │                       │
│              │  (singletons with   │                       │
│              │   subscribe/notify) │                       │
│              └─────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Editor Architecture (CodeMirror 6 Live Preview)

Following Obsidian's approach: **single editor, two views via decorations**

```
CodeMirror 6 EditorView
├── State: EditorState (doc, selection, extensions)
├── Extensions:
│   ├── markdown() - Lezer parser for Markdown
│   ├── livePreviewDecorations - Widget decorations that REPLACE
│   │   markdown syntax with rendered DOM (images, math, etc.)
│   ├── syntaxHighlighting - Lezer-based token colors
│   ├── keymap - Custom bindings (formatting, shortcuts)
│   ├── history - Undo/redo
│   ├── lineNumbers / highlightActiveLineGutter
│   └── placeholder / autocompletion (wiki-links, emoji, etc.)
└── View: EditorView (DOM rendering, decorations, coordinates)
```

**Mode switching:**

- **WYSIWYG (default):** `livePreviewDecorations` active → syntax hidden, rendered inline
- **Source:** `livePreviewDecorations` disabled → raw markdown with syntax highlight
- **Split:** Independent CodeMirror views for the primary and optional secondary document. `writemd-workspace` owns available width and pane constraints; resizing preserves the mounted views and their selections.

### 4.5 Workspace and interaction boundaries

- `WorkspaceState` persists preferred pane and rail widths in pixels. `paneGeometry` derives the rendered width from available space, reserving 320px for each document pane and a 5px gutter. When both minimums cannot fit, Document/Second pane controls select one visible surface; both stay mounted.
- The second pane is **tabbed**, not picker-driven. `SplitSurface` is `'files' | 'backlinks' | 'file' | 'preview'` with no launcher value: every surface is one click from every other, the pane opens on `'files'`, and closing the pane returns to `'files'` rather than to a menu that no longer exists. The Document tab opens the file picker when no secondary document is open, replacing the launcher row that used to. The Preview tab renders the export of the open document through `renderExportHtml` from `src/shared/export-html.ts` - the same builder the main process writes to disk, so preview and file cannot drift - at true page dimensions with live page size, margin and theme controls. Its frame is sandboxed with `allow-same-origin` and without `allow-scripts`, so it can measure the document and grow past one page; page-break guides are indicative, because `printToPDF` paginates itself. `TabDragController` drops a tab onto a group header to file it away; a hovered group takes a dashed accent outline distinct from the solid insertion outline, a group is not a target for its own members, and a folder closed at drop time opens itself so the document is not filed out of sight.
- `writemd-workspace` adapts Web Awesome's split panel and supports pointer and keyboard resizing. Window constraints never overwrite preferred width. Opening and closing the second pane animate its allocated width with the same 180ms timing and easing as `writemd-rail-frame`; both panes resize together. The closing surface stays mounted and inert until its allocation is released. Rapid reversals continue from the current width, and compact layouts or reduced motion settle immediately. `writemd-rail-frame` retains the rail DOM when collapsed.
- `TabDragController` owns both tab orientations. Pointer activation starts after 4px, child controls cannot start a drag, the library owns edge scrolling, and cancellation never commits. `FileState.dropTab` resolves pin/group/insertion changes by stable IDs in one transaction. Lit renders keyed tab nodes. Alt+Arrow reorders from a focused tab; context menus expose pin/group actions.
- `writemd-modal` and `writemd-context-menu` adapt library behavior while retaining WriteMd content and styling. Native dialogs own background inertness; tab navigation uses a roving focus target.
- Renderer settings writes are serialized and coalesced. Reset notifies all subscribers. Save failures appear in Settings with a retry action; a failed main-process write cannot poison later writes.

### 4.6 Local backgrounds and glass

Backgrounds are application preferences, never document data or export styling. An OS image picker decodes the chosen file, caps the long edge at 2560px, and stores an app-owned copy in `userData/backgrounds` under a generated asset ID with an atomic write. The copy is JPEG unless the decoded image has transparency, which PNG would inflate by an order of magnitude for a photograph and which is base64ed across IPC on every launch. The typed preload API accepts that ID rather than arbitrary filesystem paths. Removing a background deletes the owned copy after settings save successfully and leaves the selected source image untouched.

Appearance controls provide None, Haze, Dither, ASCII, Halftone, and Scanlines, empty-only/always visibility, separate empty/content strength, haze blur, and surface opacity. Pixel effects run in a worker and cache per imported image; typing does not reprocess the artwork. Workspace images sit inside each pane, above its painted surface and below content. Their visibility is independent of surface opacity; importing an image leaves glass preferences unchanged. Empty/content preview switching follows the same strength and scope rules as the workspace. Haze preserves the sharp upper image, blends two progressively blurred copies with a fine line texture, and fades into the pane surface by 90% of an empty view or 76% of a content view. Settings previews scale the blur down; the Haze blur control scales both blurred copies. Reduced motion disables visibility transitions.

Window material is separate from CSS artwork blur. Supported Windows builds offer Mica/Acrylic; macOS uses vibrancy. Unsupported systems keep the opaque window and disable the material control. Normal appearance defaults remain opaque.

The background card and compact workspace selector reuse existing WriteMd tokens and the supplied reference. Square, edge-to-edge panes replace the original pane radius and outer gutter. Three small dots mark pane and sidebar resize areas without a continuous divider line; pointer and keyboard resizing remain available. Settings open as an application page with independently scrolling navigation and content. The New Design beta card and its obsolete preference are removed. These requested changes need formalizing in Figma.

The toolbar shares the editor's surface color, opacity, and blur as appearance changes. Window controls blend into it without a separate background or left/bottom borders. The sidebar retains the secondary frame surface. The file path stays visible in both document layouts, with the full path available on hover, and can be hidden from Editor settings. The document title renders inside the editor above the first line rather than in the header, so it scrolls with the document; it is 36px in body text colour so it reads as the note's name rather than the first heading, sits with clear space before line 1, accepts typing, and renames the file. The header keeps the reading toggle and the menu. Line numbers are centred on their line, including heading lines whose box is far taller than the digits. Each document pane shows a full-width footer beneath the document carrying the file path on the left, with word/character counts and a keyboard-accessible mode button on the right. The footer is in normal flow rather than floating over the text, so it never covers the last line and narrow panes get a real bar instead of a squeezed box. It draws no rule: the document content is masked so it fades out over the last 56px above the footer, and the 120px bottom padding of the editor keeps the final line of a document clear of that fade. The bar is a material layer, painting the shared editor surface with the surface blur, so it follows the translucency and window material settings rather than a fixed opacity. This requested placement needs formalizing in Figma.

The document title and rename field center on the full header, including the space occupied by caption controls. The workspace adds no second translucent surface behind its panes. Document menus use the shared anchored popup: labels determine their width, viewport edges constrain placement, short windows allow scrolling, and Escape restores focus to the trigger.

Each document pane has its own title, path, reading toggle, and document menu. Secondary-pane mode, rename, move, export, and find actions target its document; renaming a file shared by both panes updates both paths and later save targets. Document and text menus dismiss one another. Text menus and their submenus use viewport-constrained popups, shared SVG icons, and arrow-key navigation with focus applied after the popup opens.

Group rows use the same 13px UI text, 18px icons, and spacing as note rows in both tab layouts. A group carries an icon rather than a colour: the group's menu offers a grid of icon presets, identical in both tab layouts, and the chosen icon appears on the group row, on any "Move to" entry for that group, and on the group while it is dragged. A group with no icon, or one restored from a profile saved before presets existed, draws the folder pair, which indicates expansion. Groups saved with a colour load without it. The vertical sidebar separates pinned/grouped documents from unpinned documents with a centered 48px by 1px line, shown only when both sections exist. Updates appear at the bottom of that sidebar: Update available starts the download, progress remains visible, and Restart to update installs the downloaded release. Horizontal tabs retain the toolbar update control. The sidebar's quick actions hold New note, Open file, and New group, on the top edge, left-aligned, with the search field below them spanning the full width. Sidebar spacing follows a 4px scale, with the internal-space-no-larger-than-external rule so each group reads as a unit. New group creates an empty group and focuses its label with the default text selected, so the name can be typed immediately. It is disabled on Home, where there are no documents to group. Pinned and unpinned documents are separated by their order, not by a drawn rule. In vertical tabs the document header sits in the title bar and is a window-drag region, so the window can be moved by its empty space while the header's controls still take clicks; in horizontal tabs the header is not a drag region, so text selection there is unaffected. The revised pane actions, separator, and update placement need formalizing in Figma.

Home uses the same shell, caption controls, sidebar, settings page, and command search as the editor. Vertical mode remains the default; explicit horizontal preferences are retained. The former welcome frame, separate toolbar, watermark, and fixed columns are replaced by responsive New note/Open file actions and recent-note rows with paths. Native buttons support keyboard activation, and shortcut hints follow user bindings. Home uses workspace artwork with empty-view strength and scope. Its empty sidebar and empty recent-note list say "Nothing"; redundant Home and vault-folder shortcuts are removed. Recent-file subscriptions update the page without allowing stale vault responses to replace newer notes. Shared action and navigation icons use an 18px size across home, settings, and the editor; caption symbols and small status indicators retain their native geometry. These requested home and icon changes need formalizing in Figma.

Settings now open as an application page. Search sits at the top of its sidebar, using the same search component and inset as the document sidebar. Writing contains New notes, Editor, and Files & vault; Workspace contains Appearance and Keyboard shortcuts; Application contains Advanced and About WriteMd. Navigation uses shared chrome icons, 34px minimum row heights, and 24px between groups. Back to editor remains at the bottom. Exact category names take priority in search; row searches still highlight settings and support Enter/arrow navigation. This requested sidebar layout supersedes the earlier centered settings presentation and needs formalizing in Figma.

Settings cards use theme surfaces, consistent 16px padding, readable descriptions, and 34px controls. Rows wrap to fit the available content width; font and theme grids adapt without horizontal overflow. Dropdowns use the shared Web Awesome select styling, including background settings. Monochrome accents follow the theme's text color with a contrasting surface-colored toggle thumb; colored accents choose a light or dark foreground according to luminance. The bundled editor font choices are Inter, Manrope, DM Sans, Space Grotesk, JetBrains Mono, and Geist Mono. Removed serif/handwritten selections migrate to Manrope, retaining other editor preferences.

---

## 5. UI/UX Specification (from Figma)

### 5.1 Layout Structure

The original Figma pane frame below is superseded by the requested flat workspace described in section 4.6. Tabs, toolbar controls, fonts, and theme tokens retain the existing design.

```
┌─────────────────────────────────────────────────────────────┐
│  Top Bar (height: 43px, custom frameless drag area)         │
│  [Menu] [Settings]  [Tab 1] [Tab 2] ... [Split] [Min/Max/X] │
├─────────────────────────────────────────────────────────────┤
│  Split View / Panel (theme surface, radius: 0, no gutter)   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Editor Surface / Split Windows                       │  │
│  │  - WYSIWYG Mode (Live Preview)                        │  │
│  │  - Source Mode (raw Markdown with line numbers)       │  │
│  │  - Split Mode (side-by-side synchronized panes)       │  │
│  │                                                       │  │
│  │  [Floating Mode Toggle: Live | Source | Split]        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

> **Design Alignment Note:**
> The original PRD draft proposed a traditional desktop layout with a dedicated Title Bar, a separate full-width Toolbar below it, and a persistent bottom Status Bar.
> **The Figma design eliminates both the separate titlebar and status bar in favor of a unified Top Bar and minimal chrome.** All window controls, menu options, file tabs, and split toggles reside in the 43px Top Bar. Mode switching is handled via floating pill controls (`ModeToggle`).

### 5.2 Key Design Primitives from Figma

| Component         | Selector                | Figma Spec / Visual Details                                                                                                                                             |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Top Bar**       | `<writemd-top-bar>`     | 43px height, menu icon (`Group.svg`), settings icon (`Settings.svg`), tab strip, split view icon (`Component 29 (1).svg`), window controls. `-webkit-app-region: drag`. |
| **Tab**           | `<writemd-tab>`         | 32px height, max-width 169px. Active: `rgba(255,255,255,0.05)` bg, `#D4D4D4` text, close button. Inactive: `#737373` text, 2px left separator pipe.                     |
| **Panel**         | `<writemd-panel>`       | Container for editor panes & welcome view. `#141414` bg, 10px radius, 1px gradient border (`#282828` → `#000000`). Optional 49px top fade bar.                          |
| **Action Button** | `<writemd-button>`      | 44px button in gradient border wrapper. `#161616` bg, 5px radius, Geist Mono 14px/16px text, 20×20 icon.                                                                |
| **Icon Button**   | `<writemd-icon-button>` | 26×20px (or 28×28px for window controls). Hover `rgba(255,255,255,0.05)`, color `#737373` → `#D4D4D4`.                                                                  |
| **Mode Toggle**   | `<writemd-mode-toggle>` | Floating pill menu with Live / Source / Split options and shortcut hint (`Ctrl + Shift + E`).                                                                           |

### 5.3 Features in PRD Not Represented in Figma Design

The following functional capabilities are fully specified in the PRD logic and state machines but currently do **not** have explicit mockups in Figma:

1. **Inline Table UI / Floating Table Toolbar** (insert row/column, cell alignments, delete).
2. **Inline Image Resize Handles** (click-to-resize drag handles on rendered images).
3. **Application Menu Dropdown** (File, Edit, View, Insert, Window, Help menus invoked by the hamburger icon).
4. **Settings Modal** (General, Editor, Appearance, Shortcuts, Files/Vault configuration tabs).
5. **PDF / HTML Export Dialog** (margins, paper size, styling selections).
6. **File Conflict Resolution Dialog** (external file modification 3-way diff / prompt).
7. **Find & Replace Overlay** (`Ctrl+F` / `Ctrl+H` search bar).
8. **Word Count / Reading Time display** (originally in bottom status bar; needs a home such as the floating pill or document info popover).
9. **Vault Sidebar File Tree** (collapsible file browser for the default vault).
10. **About Dialog & Keyboard Cheatsheet modal**.

---

## 6. File Handling Strategy

### 6.1 Hybrid Vault Model (Core Differentiator)

| Scenario                                                   | Behavior                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **New File** (`Ctrl+N`)                                    | Created in **default vault** (`~/Documents/WriteMd Vault/` or user-chosen on first run). No "Save As" prompt. |
| **Open Existing File** (double-click, drag-drop, `Ctrl+O`) | Opens from **original location**. Saves back to **same location**.                                            |
| **Save As**                                                | User chooses location (can be vault or anywhere).                                                             |
| **Recent Files**                                           | Tracks both vault and external files.                                                                         |

**Vault is opt-in convenience for new files only.** Not a constraint.

### 6.2 Vault Implementation

- **Default:** `~/Documents/WriteMd Vault/` (created on first launch)
- **Changeable:** Settings → "Default Vault Location"
- **Structure:** Flat or user-created folders (no enforced structure)
- **No database/index** - just a filesystem folder. File Explorer sidebar shows vault contents.

### 6.3 Open Any File

- **File association:** Register `.md`, `.markdown`, `.mdown`, `.mkd` on install
- **Recent files:** Stored in `config.json` under `files.recentFiles`. There is
  no IndexedDB and no separate `recent-files.json`.
- **Drag-drop:** Accept files on window + toolbar drop zone
- **Command line:** `writemd path/to/file.md` (for "Open With" integration)

### 6.4 Save Strategy

| Trigger           | Behavior                                                             |
| ----------------- | -------------------------------------------------------------------- |
| Auto-save         | Debounced 500ms after last keystroke. Write to temp → atomic rename. |
| Manual (`Ctrl+S`) | Immediate write to **original file path** (vault or external).       |
| Window close      | Prompt if dirty. Auto-save first.                                    |
| External change   | Detect via `fs.watch` → prompt reload (diff preview).                |

### 6.5 Image Handling

- **Vault files:** Save to `{vaultDir}/_assets/{uuid}.{ext}` → relative path `./_assets/uuid.png`
- **External files:** Save to `{fileDir}/_assets/{uuid}.{ext}` → relative path `./_assets/uuid.png`
- **Cleanup:** On save, scan sibling `_assets/` for unreferenced files → prompt delete
- **Resize:** Store `width="300"` attribute in markdown (GFM extension)

### 6.6 Conflict Resolution

- Maintain `mtime` + content hash on load
- On save: if `mtime` changed → show 3-way diff (original, current, disk)
- Options: Overwrite, Keep Mine, Merge (manual)

---

## 7. Markdown Spec Compliance

### 7.1 Core (GFM + Extensions)

| Feature                        | Parser | Editor | Preview |
| ------------------------------ | ------ | ------ | ------- |
| Headings (1-6)                 | ✅     | ✅     | ✅      |
| Bold/Italic/Strike             | ✅     | ✅     | ✅      |
| Lists (ordered/unordered/task) | ✅     | ✅     | ✅      |
| Blockquotes                    | ✅     | ✅     | ✅      |
| Code (inline/fenced)           | ✅     | ✅     | ✅      |
| Links/Images                   | ✅     | ✅     | ✅      |
| Tables (GFM)                   | ✅     | ✅     | ✅      |
| Auto-links                     | ✅     | ✅     | ✅      |
| Strikethrough                  | ✅     | ✅     | ✅      |

### 7.2 Extensions (Enabled by Default)

| Extension        | Syntax            | Editor Support       | Preview           |
| ---------------- | ----------------- | -------------------- | ----------------- |
| Frontmatter      | `--- yaml ---`    | Collapsible block    | Hidden (metadata) |
| Math (KaTeX)     | `$...$` `$$...$$` | Inline widget        | Rendered          |
| Mermaid          | `mermaid`         | Code block + preview | Rendered (lazy)   |
| Footnotes        | `[^1]`            | Tooltip on hover     | Rendered          |
| Definition Lists | `term: def`       | Basic                | Rendered          |
| Task Lists       | `- [ ]`           | Clickable checkbox   | Interactive       |
| Emoji            | `:smile:`         | Autocomplete         | Rendered          |
| Highlight        | `==text==`        | Mark style           | Rendered          |
| Sub/Superscript  | `~sub~` `^sup^`   | Basic                | Rendered          |

### 7.3 Obsidian Compatibility (Optional)

- Wiki-links `[[page]]` → resolve to sibling `.md` files
- Embeds `![[image.png]]` → render inline
- Callouts `> [!note]` → styled blocks
- Tags `#tag` → index for search

---

## 8. Keyboard Shortcuts (Default)

| Action         | Shortcut (Win/Linux) | Shortcut (macOS)        |
| -------------- | -------------------- | ----------------------- |
| **File**       |                      |                         |
| New File       | `Ctrl+N`             | `Cmd+N`                 |
| Open File      | `Ctrl+O`             | `Cmd+O`                 |
| Save           | `Ctrl+S`             | `Cmd+S`                 |
| Save As        | `Ctrl+Shift+S`       | `Cmd+Shift+S`           |
| Export PDF     | `Ctrl+E`             | `Cmd+E`                 |
| **Edit**       |                      |                         |
| Undo/Redo      | `Ctrl+Z` / `Ctrl+Y`  | `Cmd+Z` / `Cmd+Shift+Z` |
| Find           | `Ctrl+F`             | `Cmd+F`                 |
| Replace        | `Ctrl+H`             | `Cmd+Option+F`          |
| **Format**     |                      |                         |
| Bold           | `Ctrl+B`             | `Cmd+B`                 |
| Italic         | `Ctrl+I`             | `Cmd+I`                 |
| Strikethrough  | `Ctrl+Shift+X`       | `Cmd+Shift+X`           |
| Code Inline    | `Ctrl+`` `           | `Cmd+`` `               |
| Link           | `Ctrl+K`             | `Cmd+K`                 |
| Image          | `Ctrl+Shift+I`       | `Cmd+Shift+I`           |
| **Structure**  |                      |                         |
| Heading 1-6    | `Ctrl+1..6`          | `Cmd+1..6`              |
| Toggle List    | `Ctrl+L`             | `Cmd+L`                 |
| Toggle Task    | `Ctrl+Shift+L`       | `Cmd+Shift+L`           |
| Blockquote     | `Ctrl+Shift+.`       | `Cmd+Shift+.`           |
| Code Block     | `Ctrl+Shift+C`       | `Cmd+Shift+C`           |
| Table          | `Ctrl+T`             | `Cmd+T`                 |
| Math Block     | `Ctrl+Shift+M`       | `Cmd+Shift+M`           |
| **View**       |                      |                         |
| Toggle Preview | `Ctrl+E`             | `Cmd+E`                 |
| Toggle Split   | `Ctrl+Alt+S`         | `Cmd+Opt+S`             |
| Show Files     | `Ctrl+Shift+E`       | `Cmd+Shift+E`           |
| Show Backlinks | `Ctrl+Shift+B`       | `Cmd+Shift+B`           |
| Zoom In/Out    | `Ctrl+=` / `Ctrl+-`  | `Cmd+=` / `Cmd+-`       |
| Reset Zoom     | `Ctrl+0`             | `Cmd+0`                 |

The only bindings actually registered are the ones in
`src/renderer/src/state/shortcuts.ts`. That registry covers File (new, open,
save, save-as, export), Edit (find, replace), View (quick toggle, split view,
files/backlinks panels, zoom) and App (settings, command palette). The
formatting, link, image and block-structure rows above are aspirational: the
note context menu inserts that markup, but those keys are not bound. Export
also has no default binding.

---

## 9. Settings Schema (persisted in `config.json`)

Source of truth is `src/shared/settings-schema.ts`. Nothing here holds a secret:
the API key storage the app used to keep has gone with the AI assistant, so the
file is plain preferences.

```json
{
  "editor": {
    "fontSize": 15,
    "fontFamily": "JetBrains Mono",
    "lineHeight": 1.7,
    "wordWrap": true,
    "tabSize": 2,
    "vimMode": false,
    "typewriterMode": false,
    "autoSave": true,
    "autoSaveDelay": 500,
    "showLineNumbers": false,
    "highlightActiveLine": true
  },
  "preview": {
    "fontSize": 16,
    "fontFamily": "Manrope",
    "lineHeight": 1.8,
    "maxWidth": 800,
    "showMargin": true
  },
  "appearance": {
    "theme": "dark",
    "accentColor": "",
    "panelOrientation": "horizontal"
  },
  "files": {
    "vaultPath": "",
    "recentFilesMax": 10,
    "recentFiles": [],
    "openTabs": [],
    "activeTabPath": null,
    "imageFolderName": "_assets",
    "cleanupUnusedImages": "prompt",
    "defaultNewFileContent": "",
    "defaultNewFileName": "Untitled.md"
  },
  "export": {
    "pdfMargin": 24,
    "pdfPageSize": "A4",
    "pdfTheme": "light",
    "htmlStandalone": true
  },
  "advanced": {
    "enableMermaid": true,
    "enableWikiLinks": false,
    "spellCheck": false,
    "portableMode": false
  },
  "shortcuts": {
    "bindings": {}
  }
}
```

Themes: `dark`, `graphite`, `midnight`, `light`, `paper`, `dracula`, `nord`.

> Note: `appearance.customCSS`, `appearance.toolbarVisible`,
> `appearance.statusBarVisible` and `appearance.sidebarWidth` were in this
> schema but nothing read them. They were removed rather than left as dead keys.
> Older `config.json` files may still carry them; the loader ignores unknown
> keys.

---

## 10. Build & Distribution

### 10.1 Development

```bash
# Install
pnpm install

# Dev (hot reload)
pnpm dev

# Typecheck
pnpm typecheck

# Lint
pnpm lint

# Test
pnpm test
pnpm test:e2e
```

### 10.2 Production Build

```bash
# Build all platforms
pnpm build

# Output: dist/
# - writemd-Setup-x.y.z.exe (Windows NSIS)
# - writemd-x.y.z.dmg (macOS universal)
# - writemd-x.y.z.AppImage (Linux)
```

### 10.3 Auto-Update

- **Provider:** GitHub Releases (private/public repo)
- **Channel:** Stable only (no beta channel for MVP)
- **Check:** On startup + periodic (24h)
- **UI:** Non-intrusive banner → "Restart to Update"

---

```
writemd/
├── .github/
│   ├── workflows/           # ci.yml, release.yml
│   └── dependabot.yml
├── docs/                    # FAQ, fixtures, screenshots
├── resources/               # app icon
├── scripts/                 # release-time helpers
├── src/
│   ├── main/                # main process
│   │   ├── index.ts             # BrowserWindow, lifecycle, navigation guard
│   │   ├── ipc.ts               # every main<->renderer channel
│   │   ├── path-guard.ts        # vault + registered-path containment
│   │   ├── vault.ts             # vault root, tree, migration
│   │   ├── settings.ts          # config.json read/write, keyring
│   │   ├── export.ts            # PDF / HTML / DOCX
│   │   ├── updater.ts           # electron-updater wiring
│   │   └── file-associations.ts
│   ├── preload/
│   │   ├── index.ts             # contextBridge surface
│   │   └── index.d.ts           # window.electronAPI typing
│   ├── renderer/
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── renderer.ts      # bootstrap
│   │   │   ├── components/      # Lit web components (flat)
│   │   │   │   ├── App.ts           # root layout
│   │   │   │   ├── TopBar.ts        # titlebar, window controls, tab slot
│   │   │   │   ├── Tab.ts           # one tab
│   │   │   │   ├── VerticalTabBar.ts
│   │   │   │   ├── Editor.ts        # CodeMirror host, split, resizer
│   │   │   │   ├── DocBar.ts        # per-pane title bar + note menu
│   │   │   │   ├── FindPanel.ts
│   │   │   │   ├── LivePreview.ts   # live-preview facet/extension
│   │   │   │   ├── EditorTheme.ts   # CodeMirror theme
│   │   │   │   ├── SettingsModal.ts
│   │   │   │   ├── CommandPalette.ts
│   │   │   │   ├── ConflictDialog.ts
│   │   │   │   ├── ConfirmDialog.ts
│   │   │   │   ├── WelcomeScreen.ts
│   │   │   │   ├── VaultExplorer.ts
│   │   │   │   ├── BacklinksPanel.ts
│   │   │   │   ├── TextMenu.ts      # note context menu
│   │   │   │   ├── menu-styles.ts   # shared menu CSS
│   │   │   │   └── ...              # Button, IconButton, InfoPill, ModeMenu,
│   │   │   │                        # ModeToggle, Panel, Sidebar
│   │   │   ├── components/
│   │   │   │   ├── extensions/      # CodeMirror extensions
│   │   │   │   │   ├── live-decorations.ts, live-table.ts
│   │   │   │   │   ├── wiki-link-plugin.ts, link-click.ts, safe-links.ts
│   │   │   │   │   ├── frontmatter-plugin.ts, math-plugin.ts
│   │   │   │   │   ├── table-keys.ts, table-line.ts, table-toolbar.ts
│   │   │   │   │   ├── list-continuation.ts, slash-command.ts
│   │   │   │   │   ├── freeze-mouse.ts, read-only.ts, tree-progress.ts
│   │   │   │   └── widgets/         # live-preview node widgets
│   │   │   │       ├── TableWidget.ts, ImageWidget.ts, MathWidget.ts,
│   │   │   │       ├── MermaidWidget.ts, CodeBlockWidget.ts,
│   │   │   │       ├── BulletWidget.ts, TaskCheckboxWidget.ts
│   │   │   ├── state/             # singletons: file, settings, shortcuts, conflict
│   │   │   ├── styles/            # global.css, themes.css
│   │   │   └── utils/links.ts
│   └── shared/                # imported by both processes
│       ├── electron-api.ts        # bridge type surface
│       └── settings-schema.ts     # WriteMdSettings + DEFAULT_SETTINGS
├── tests/
│   ├── helpers/temp-root.ts
│   ├── setup.ts                   # jsdom shims
│   ├── e2e/                       # Playwright, launches the real app
│   └── *.test.ts                  # vitest, jsdom
├── electron.vite.config.ts
├── electron-builder.yml
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json / tsconfig.test.json
└── README.md
```

---

## 12. Milestones & Timeline

This section is the original plan, kept for reference. It is not a status
tracker: most of it shipped and the checkboxes were never updated. For actual
progress see `phases.md` (this directory) and the release notes. Two corrections worth carrying
forward: the theme system ships 7 themes, not 5, and settings persist to
`config.json`, not IndexedDB.

### Phase 1: Foundation (Week 1-2)

- [ ] Electron + Vite + TypeScript setup
- [ ] Main/Renderer IPC + Preload
- [ ] Frameless window + custom titlebar
- [ ] Basic layout (AppShell, Toolbar, StatusBar)
- [ ] Theme system (CSS variables, 7 themes)
- [ ] Settings persistence (`config.json`)
- [ ] Vault setup: default `~/Documents/WriteMd Vault/`, picker UI, file watcher
- [ ] File associations (register .md on install)

### Phase 2: Editor Core (Week 3-5)

- [x] CodeMirror 6 integration
- [x] Markdown parser (Lezer) + syntax highlighting
- [x] Live Preview decorations (WYSIWYG)
- [ ] Toolbar → formatting commands
- [ ] Keyboard shortcuts
- [x] Mode toggle (WYSIWYG/Source/Split)

### Phase 3: File & Image Handling (Week 6)

- [x] Open/Save dialogs + drag-drop (vault + external)
- [x] File association registration
- [x] Auto-save + dirty tracking
- [x] Recent files (vault + external)
- [x] Image paste/drop → sibling `_assets/`
- [ ] Image resize handles
- [x] Vault file explorer sidebar

### Phase 4: Advanced Editing (Week 7-8)

- [ ] Tables (insert, edit, toolbar)
- [ ] Code blocks (language, highlight, line numbers)
- [ ] Math (KaTeX inline/block)
- [ ] Mermaid (lazy load)
- [ ] Find/Replace
- [ ] Frontmatter editor

### Phase 5: Export & Polish (Week 9)

- [ ] PDF export (puppeteer or @electron/print)
- [ ] HTML export
- [ ] Welcome/Empty state
- [ ] Settings modal (all tabs)
- [ ] Keyboard shortcut customization
- [ ] Command palette

### Phase 6: Release Prep (Week 10)

- [ ] Auto-updater
- [ ] Code signing (Windows/macOS). Still open. `electron-builder.yml` has no
      `win.signtoolOptions` and no `mac.identity`, and `notarize: false`. On macOS
      `quitAndInstall` uses Squirrel, which requires a signed and notarized build, so
      the install path will fail until this is done.
- [ ] Installer build + test
- [ ] Documentation (README, keyboard shortcuts)
- [ ] Beta testing
- [ ] v1.0 release

> Note: the auto-updater feed cannot resolve today.
> `electron-builder.yml` publishes with `provider: github` and no `owner` or
> `repo`, and `package.json` has no `repository` field, so electron-updater has
> nowhere to look for a release. Separately, `SettingsModal.ts` renders a thrown
> update-check error as "up-to-date", so this is not visible from the UI.

---

## 13. Success Metrics

| Metric                   | Target                               |
| ------------------------ | ------------------------------------ |
| Cold start time          | < 1.5s (Windows), < 1s (macOS/Linux) |
| Memory (idle, 1 file)    | < 120 MB                             |
| Memory (10 MB file)      | < 200 MB                             |
| Open file latency        | < 100ms                              |
| Typing latency (WYSIWYG) | < 16ms (60fps)                       |
| Bundle size (installer)  | < 80 MB                              |
| Crash-free sessions      | > 99.5%                              |

---

## 14. Risks & Mitigations

| Risk                                 | Likelihood | Impact | Mitigation                                                               |
| ------------------------------------ | ---------- | ------ | ------------------------------------------------------------------------ |
| CodeMirror 6 Live Preview complexity | High       | High   | Start with proven extensions; study Obsidian's approach; prototype early |
| Electron bundle size                 | Medium     | Medium | Tree-shake aggressively; lazy-load heavy deps (Mermaid, KaTeX, PDF)      |
| Image handling edge cases            | Medium     | High   | Comprehensive test suite; use sharp for optimization                     |
| File association conflicts           | Low        | High   | Test on clean VMs; provide "Open With" fallback                          |
| Math rendering performance           | Low        | Medium | KaTeX is fast; only render visible blocks                                |
| Cross-platform CSS quirks            | Medium     | Low    | Test on all 3 OSes; use CSS reset + system fonts                         |

---

## 15. Open Questions

1. **Plugin system?** - Not for MVP. Consider after v1.0 if demand exists.
2. **Sync?** - Out of scope. Users can use Syncthing, iCloud, Dropbox on the vault folder.
3. **Mobile?** - Capacitor wrapper later. Desktop first.
4. **License?** - MIT or AGPL? Recommend MIT for adoption.
5. **Name "WriteMd"** - Confirm trademark availability.

---

## 16. Non-Goals (Explicit)

| Non-Goal                       | Reason                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| **User accounts / cloud sync** | "Install and use" - local-first, no backend                             |
| **Plugin marketplace**         | MVP scope; core editing first                                           |
| **Collaboration / real-time**  | Different product category                                              |
| **Database / index**           | Filesystem is the source of truth                                       |
| **Vault lock-in**              | Vault is convenience for new files only; external files fully supported |

---

## Appendix: Figma Mapping

| Figma Frame/Component          | PRD Section | Status                         |
| ------------------------------ | ----------- | ------------------------------ |
| Main Window Layout             | 5.1         | ✅ Designed                    |
| Toolbar Groups                 | 5.2         | ✅ Designed                    |
| Editor Surface (WYSIWYG)       | 5.2         | ✅ Designed                    |
| Source Mode View               | 5.2         | ✅ Designed                    |
| Split View                     | 5.2         | ✅ Designed                    |
| Sidebar (Files/Outline/Search) | 5.1         | ✅ Designed                    |
| Status Bar                     | 5.2         | ✅ Designed                    |
| Image Inline UX                | 5.2         | ✅ Designed                    |
| Table Floating Toolbar         | 5.2         | ✅ Designed                    |
| Code Block Header              | 5.2         | ✅ Designed                    |
| Math Rendering                 | 5.2         | ✅ Designed                    |
| Settings Modal                 | 5.3         | 🔄 In Progress                 |
| Application Menu               | 5.3         | 🔄 In Progress                 |
| Welcome/Empty State            | 5.3         | 🔄 In Progress (add vault CTA) |
| Export Dialog                  | 5.3         | 🔄 In Progress                 |
| Conflict Dialog                | 5.3         | 🔄 In Progress                 |
| About Dialog                   | 5.3         | ⏳ Pending                     |
| Shortcut Cheatsheet            | 5.3         | ⏳ Pending                     |

---

**Document Version:** 1.1
**Last Updated:** 2026-09-30
**Author:** danieldamilola
**Status:** Shipped (v1.1.0)

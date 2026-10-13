# WriteMd Implementation Roadmap

Tracker for what shipped in v1.0.0 and what lands in v1.1.0. Each v1.1.0 item carries acceptance criteria; nothing counts as done until `pnpm typecheck` + `pnpm test` pass.

## Current work - workspace UI repair

Output-limit repair removes the fixed 4,096-token request cap. AI Settings defaults to Automatic, omitting output limits for compatible APIs and Gemini; Anthropic retains a required 4,096-token fallback with an explicit UI description. Users can select limits through 131,072 tokens. Acceptance covers provider payloads, numeric settings validation and persistence, both AI surfaces, actionable errors, and refusing truncated edits.

Verified on 2026-10-13: typecheck and production build passed; all 1,170 unit tests passed with six existing skips. Electron accepted a long draft without an app output cap, restored a custom 65,536-token setting after restart, and sent it through the side panel. Live DeepSeek wrote and saved Rust articles through the floating bar first and side panel second using Automatic. The live preview tests explicitly disable auto-accept in their isolated profiles, so user preferences cannot remove the Accept button the tests expect. Screenshots: `artifacts/ui-review/ai-output-limit-setting.png` and `ai-live-rust-*.png`.

Settings material repair removes the hidden workspace's paint while preserving its editor state. Settings owns one rail surface and one content surface, with its own existing background component and solid theme cards. Acceptance covers all seven themes, Mica and Acrylic when supported, no-material fallback, opacity and local backgrounds, live switching, readable controls, narrow layouts, and returning to an unsaved note. Native appearance must follow theme changes as well as material changes.

Verified on 2026-10-13: typecheck and production build passed; all 1,151 unit tests passed with six existing skips. Twenty-four Settings Electron checks passed, including all seven themes with None, Mica, and Acrylic, real native theme updates, one surface tint per region, title-bar separation, text contrast, widths of 800 and 1200 pixels, background and opacity controls, and preserved unsaved editor state. Screenshots: `artifacts/ui-review/settings-*-mica.png`, `settings-*-acrylic.png`, and `refined-appearance-*.png`.

The AI Settings auto-accept toggle defaults to off. When enabled, completed floating-bar suggestions use the normal acceptance path automatically, including current-note selection checks, external-file conflict checks, and confirmation. Acceptance covers saved preferences after restart, automatic full-note and selected-text edits, multiple files, follow-ups, and failed acceptance without repeated attempts. Existing side-panel automatic edits remain unchanged.

Verified on 2026-10-13: typecheck and production build passed; all 1,136 unit tests passed with six existing skips. Eleven Electron checks passed, including auto-accept in graphite and paper themes, restart persistence, successive full-note and selected-text changes, multiple files, external-file undo, and manual-accept regressions. Screenshots: `artifacts/ui-review/ai-auto-accept-*.png`.

Accepting a floating AI edit keeps the conversation visible and confirms the applied change. Follow-ups use the accepted document text and updated selection range. Acceptance covers full-note and selected-text edits, saved contents, successive edits without reopening the bar, and edits to other files.

Verified on 2026-10-13: typecheck and production build passed, 56 related unit tests passed, and all nine floating-bar Electron tests passed. Successive full-note and selected-text edits saved correctly with the bar still visible, in graphite and paper themes. Screenshots: `artifacts/ui-review/ai-accept-followup-note.png` and `ai-accept-followup-selection.png`.

Provider expansion adds OpenRouter, DeepSeek, Groq, Mistral, and xAI using the OpenAI-compatible adapter. Acceptance covers default endpoints and models, provider selection and persistence, model discovery, streamed text and tool calls, signed metadata replay, and existing local providers. Verify the Settings picker in the running Electron app with screenshots.

Verified on 2026-10-13: typecheck and production build passed; all 1,129 unit tests passed with six existing skips. Electron verified all five provider defaults, model discovery against a local test server, saved configuration, and restoration after restart. Dark and paper screenshots are in `artifacts/ui-review/ai-providers-*.png`. Live requests to the new services remain unverified until their API keys are configured.

Live DeepSeek model discovery passed on 2026-10-13. The Settings Fetch button called `https://api.deepseek.com/models` with the saved key and received HTTP 200. The picker and saved cache matched the response exactly: `deepseek-flash`, `deepseek-v4-pro`. The isolated test clears its cache before fetching and removes copied encrypted credentials after closing. Test: `tests/e2e/ai-models-live.spec.ts`; screenshot: `artifacts/ui-review/ai-models-deepseek-live.png`. Live model discovery for the other new providers remains unverified.

Article drafting targets the open note, including an empty note. Acceptance covers the natural request "please write an article on rust and please use the unslop skill", edit proposals in the floating bar, side-panel writes, one retry for missing edit blocks, and read-only explanations or explicit chat replies.

The Electron article test passed with controlled provider responses, floating bar first and side panel second, checking saved external files and editor contents. Screenshots are in `artifacts/ui-review/ai-article-*.png`. The live article attempt was rejected by the selected OpenAI account because it had no remaining API credits; the earlier live Gemini text-edit test below remains separate.

Floating AI and the side panel share a saved conversation. Acceptance requires stable session IDs across follow-ups, prior context in provider requests, history entries for floating replies, normal shortcut access to the transcript, session restoration after restart, and shared cancellation without losing a live turn while switching surfaces.

Verified: typecheck and build passed. All 1,102 unit tests passed with six existing skips. Six Electron checks passed, including follow-up context, opening the panel by shortcut, one history entry per conversation, restart restoration, live handoff, and external edit regression checks. Screenshots are in `artifacts/ui-review/ai-shared-conversation*.png`.

Live edit verification on 2026-10-13 used the configured Gemini provider. The floating bar changed a temporary external Markdown file and saved the accepted edit first. The side panel then changed the same file and saved it in place. Exact disk contents and editor text matched both requested edits. The opt-in test is `tests/e2e/ai-edit-live.spec.ts`; screenshots are in `artifacts/ui-review/ai-live-*.png`.

AI edits support requested Markdown files outside the vault. Acceptance checks cover external notes, all supported Markdown extensions, the current unsaved draft, preview acceptance, disk conflicts, original-path saves, and undo. General file IPC permissions still use the existing vault and registered-path checks.

Verified: typecheck and build passed. All 1,098 unit tests passed with six existing skips. Four Electron prompt-bar tests passed, including external note edits, accepted edits to an unopened external file, full-chat edits, and undo. Screenshots are in `artifacts/ui-review/ai-external-*.png`.

This section tracks the workspace UI changes prepared for v1.4.0. Historical release sections below retain their original scope. Release notes are in [CHANGELOG.md](../CHANGELOG.md).

- [x] The floating AI bar.
  - Acceptance: the AI button in the toolbar, the icon in the vertical panel, and Ctrl+Alt+A open one floating bar at the foot of the document; the bar measures itself against the pane being written in and follows it as the chat panel, a split pane or the tab rail changes the workspace width; it stays open when the document is clicked, closes from the AI button or the hotkey, collapses to a handle from the down arrow and from Escape without losing the transcript or the draft, and closes on a second Escape; the waiting state replaces the prompt in place with Stop in the send control's row; replies render as Markdown; Open full chat carries the transcript, note and selection to the panel and closes the bar; the bar sends open tabs and resolves `@` notes, can propose changes to any file in the vault with each one reviewed before it is written, allows requested Markdown files outside the vault and saves to their original locations, and reports which files a turn changed; Explain and Summarize open the bar with their question typed in; Ctrl+J and Ctrl+Alt+Shift+A both open the chat panel; conversations can be deleted from the history menu without closing it; the Unslop skill ships into every vault and is applied to every reply; the prompt tells the model which reference is a note and which is a skill; the chat prompt and the bar share one fill, border and focus step; the chat panel opens and closes on the sidebar's 180ms panel motion, is held mounted for its exit, and resolves on the next frame under reduced motion; the document footer takes its colour from the pane. Verify typecheck, unit tests, and Electron screenshots in both themes and at compact sizes.

- [x] AI chat consistency and completion.
  - Acceptance: chat and its multiline composer reuse workspace typography, icons, theme tokens, and spacing; available provider models can be fetched and switched in the composer without exposing a stored key; the toolbar opens a centered prompt-only quick action; selected-text and whole-note edit suggestions are previewed and can be accepted only while their captured text is current; saved chats restore their transcripts; cancellation, stale requests, context references, attachments, file edits, and undo work. Typecheck, AI regression tests, and Electron screenshots verify compact/wide layouts and dark/light themes.
  - Verified: typecheck passed; the full suite passed 968 unit tests with six existing skips before the design refinement; all 56 tests covering the revised chat controls passed. Eight AI Electron tests cover dark/light conversations, shared history menus, long note references, compact model menus, and native window bounds down to 800x600. Screenshots are in `artifacts/ui-review/ai-chat-*.png`.

- [x] AI selection actions, sidebar access, and research.
  - Acceptance: inline prompt guidance; API-key Settings link opens the AI section; captured selections explain or summarize only that text; AI panel supports persisted pointer and keyboard resizing; enabled AI appears beside icon-only Settings and above it in the collapsed strip; Ctrl+B toggles the sidebar; new profiles enable AI; hidden writing guidance excludes en/em dashes; bounded web search returns source links and handles failure/cancellation. Verify typecheck, affected regression tests, and running Electron screenshots.
  - Verified: typecheck and build passed. The full unit suite passed 1,011 tests with six existing skips; final backend checks passed 104 tests, followed by nine checks for the resize-release fix and API-key guard. All eleven AI Electron scenarios passed, including reruns after fixing Settings test selectors and the final resize build. A live search returned real source URLs and snippets. Screenshots in `artifacts/ui-review/` cover selection menus, inline guidance, expanded/collapsed sidebar icons, home chat, resized/compact panels, and both themes.

- [x] WriteMd AI artwork, compact prompt controls, and personal skills.
  - Acceptance: horizontal chrome has the supplied AI icon; expanded sidebar separates Settings and AI across its footer; collapsed strip keeps AI above Settings; assistant activity uses the supplied eyes/float animation only during live responses and honors app/system reduced motion; composer starts shorter with rounded controls. AI Settings opens the vault's skills folder and lists commands; leading slash autocomplete selects a SKILL.md for one request without executing scripts or reading linked folders. Invalid skills report errors, ordinary chat excludes their instructions, and edited instructions load fresh.
  - Verified: typecheck and build passed; the full unit suite passed 1,042 tests with six existing skips, followed by 32 passing checks including an additional catalog-limit regression. All 14 AI Electron scenarios passed. Screenshots in `artifacts/ui-review/` cover horizontal/vertical placement, native compact bounds, rounded input, thinking/settled states, and skill settings/autocomplete. The chat layout uses existing tokens and needs formalizing in Figma.

- [x] Visible vault skills and unified thinking state.
  - Acceptance: startup and vault changes create a visible Skills folder; named Markdown files, nested SKILL.md files, and legacy hidden skills work; the real folder IPC handler opens the folder and reports readable errors; the dev command watches main/preload changes. Waiting shows the supplied unified Thinking artwork at a readable size, with app/system reduced motion and theme colors. Reply text has no Assistant role label or icon.
  - Verified: typecheck and build passed. The full suite passed 1,048 tests with six existing skips; 30 activity/icon/dock checks passed after the final artwork size fix. Seven affected Electron scenarios passed, with the folder-action case rerun after correcting its test text and the thinking/folder checks rerun against the final build. The real Open skills folder handler covers success, failure, and retry. Screenshots in artifacts/ui-review show Thinking in dark/light themes and the visible skills folder controls. The user's vault Skills folder was created without changing existing notes.

- [x] Shared workspace shell.
  - Acceptance: home, settings, and documents use the shared full-height sidebar and workspace chrome; vertical tabs are the default and existing profiles migrate once; existing themes and shared chrome icons work through reusable Lit primitives; settings open as an application page; documents, split resizing, drag ordering, backgrounds, keyboard focus, and persistence remain functional. Preserve MIT attribution for adapted source and verify in Electron with screenshots.

- [x] Settings sidebar search and navigation.
  - Acceptance: search belongs to the settings sidebar and remains clickable in both tab layouts; Writing, Workspace, and Application group clearly named categories with shared WriteMd icons and spacing; filtering, match navigation, search focus, and Back to editor work; dark/light and compact-window screenshots verify the layout.

- [x] Settings and workspace visual consistency.
  - Acceptance: all settings categories fit compact and wide windows across seven themes; cards, descriptions, switches, and custom dropdowns remain readable; minimal bundled fonts replace serif choices and existing preferences migrate; the obsolete beta card is removed; file paths and corner mode/count controls remain visible; three-dot resize handles retain pointer/keyboard behavior; caption controls blend with the editor surface. Verify dropdown reopening, keyboard selection, persistence, contrast, and screenshots in Electron.

- [x] Document header alignment and menu bounds.
  - Acceptance: actual toolbar/editor screenshot pixels match at full and reduced surface opacity; the title and its rename field center on the full header in both orientations; document menu labels fit without clipping and short windows allow scrolling; Escape restores focus and menu keyboard navigation works. Verify compact/wide windows and screenshots in Electron.

- [x] Pane actions, pinned separation, and vertical update flow.
  - Acceptance: the secondary document has its own menu and reading toggle; mode, rename, move, export, and find target the chosen pane; shared-file renames preserve both save targets; document and text menus dismiss one another, stay within the viewport, and support keyboard submenu focus; a short thin line separates pinned/grouped and unpinned documents; update availability, download progress, and restart appear at the bottom of the sidebar in vertical mode, while horizontal mode retains the toolbar control. Verify in Electron with screenshots and typed updater bridge calls.

- [x] Welcome screen consistency.
  - Acceptance: home uses the shared shell with vertical mode by default; captions, sidebar, settings, and command search match the editor; the old inner frame is removed; recent-note and new/open/vault actions work through the typed bridge; all themes and compact windows fit; workspace artwork uses empty-view strength and scope; opening and closing notes preserves the shell. Verify keyboard actions, settings navigation, screenshot bounds, and Electron screenshots.

- [x] Document footer replaces the floating corner box.
  - Acceptance: the file path and the word/character counts and mode button sit in a full-width footer in normal flow beneath each document pane, path left and controls right, so they never overlap the last line and narrow panes get a real bar; hiding the path leaves no gap and keeps the counts on the trailing edge; the title renders inside the editor above the first line and scrolls with the document, is large and in body text colour, has clear space before line 1, accepts real typing, renames the file, is hidden in source mode, and is absent from the header; the sidebar's quick actions sit left-aligned on the top edge with the search field below spanning the full width and following a 4px spacing scale; the empty title bar drags the window while its controls stay clickable; no rule separates pinned from unpinned documents; line numbers are centred on their lines including headings, and stay aligned after a live font-size or line-height change; document content fades over the last 56px above the footer in every mode including reading; the final line of a document stays clear of the fade when scrolled to the end; each split pane keeps its own path, title, counts, and mode control. Verify in Electron with screenshots in both orientations and both themes.

- [x] Group rows match notes, and groups take an icon instead of a colour.
  - Acceptance: group rows use the same text and icon size as note rows in both tab layouts; open and closed folder icons replace the arrows; the group menu offers a grid of icon presets, identical in both layouts; the chosen icon renders on the row, on "Move to" entries, and on the drag preview, and survives a reload; new groups default to the folder pair; profiles saved with a group colour load without it. Verify in Electron with screenshots in both orientations.

- [x] Shared tab dragging and stable identity transactions.
  - Acceptance: horizontal/vertical dragging, pin changes, insertion order, Escape/pointer cancellation, outside drops, stationary edge scrolling, and keyboard ordering work in Electron. Tab appearance stays intact.
- [x] Resizable workspace and rail.
  - Acceptance: pointer/keyboard resizing persists preferences, constraints preserve both pane minimums, narrow windows switch surfaces without overflow, rail allocation animates continuously, and rapid toggles/reduced motion finish correctly.
- [x] Shared modal/menu behavior.
  - Acceptance: native dialog focus makes the background inert; menu placement and keyboard navigation work through Shadow DOM; closing restores focus; nested confirmation Escape dismisses only the top dialog.
- [x] Settings notifications and write recovery.
  - Acceptance: reset reapplies all subscribed settings; compound changes write one snapshot; queued writes preserve the latest value; save failure exposes retry and subsequent main-process writes recover.
- [x] Local image backgrounds and optional glass.
  - Acceptance: import copies to owned storage, all six effects render, settings/image survive restart, removal preserves the source file, supported materials apply, unsupported platforms expose a fallback, and fonts load without a network stylesheet.
- [x] Architecture boundaries and regression coverage.
  - Acceptance: one drag controller serves both orientations; workspace geometry is separate from CodeMirror; shell subscriptions exclude content-only notifications; typecheck, unit tests, relevant Electron specs, and screenshots validate the change.
- [x] Flat workspace and settings page.
  - Acceptance: panes meet the window edges without rounded frames; three-dot resize handles remain usable; settings use the shared shell with responsive content and sidebar search; pane-local wallpaper visibility works independently of surface opacity and its scope/preview matches the workspace. Verify horizontal/vertical layouts, focus, search, and screenshots in Electron.

- [x] Home simplification and shared icon sizing.
  - Acceptance: home removes Home and vault-folder shortcuts; empty sidebar and recent-note copy reads "Nothing"; New note, Open file, settings, and keyboard creation work; action and navigation icons share an 18px size across home, settings, and both editor layouts. Verify compact windows, themes, and screenshots in Electron.

## v1.0.0 - Shipped

### Foundation

- [x] Electron + Vite + TypeScript setup, Main/Renderer IPC + typed preload bridge
- [x] Frameless window + custom unified top bar, tabs, split layout
- [x] Theme system (CSS variables; Dark, Graphite, Midnight, Light, Paper, Dracula, Nord)
- [x] Settings persistence store + Settings modal (General, Editor, Appearance, Shortcuts, Files)

### Editor

- [x] CodeMirror 6 + Lezer markdown parsing, syntax highlighting, Live Preview (WYSIWYG), Source mode, split panes
- [x] Tables (insert/edit/toolbar), math (KaTeX), Mermaid diagrams, frontmatter panel, footnotes, task lists
- [x] Slash commands, wiki-links with click-to-open, live decorations
- [x] Find/Replace overlay (`Ctrl+F` / `Ctrl+H`) with match counts and case/word/regex toggles
- [x] Command palette (`Ctrl+P`), shortcut registry with user rebind UI
- [x] Right-click text menu (formatting, headings, inserts, internal/external link insertion)

> Note: callouts. The text menu has a Callout item that inserts `> [!note]`
> (`TextMenu.ts:388`), but no extension parses or renders that syntax, so it
> displays as a plain blockquote. Insertion only.

### Files & links

- [x] Hybrid vault (`~/Documents/WriteMd Vault/`) + open-anywhere files saving back in place
- [x] Auto-save (debounced, atomic) + dirty tracking + external-change conflict dialog
- [x] Image paste/drop → sibling `_assets/` folder
- [x] Vault explorer, recent files, tabs with session restore
- [x] Cross-folder backlinks panel (wiki + markdown links, snippets, click-to-open)
- [x] Word/character counts in the document info pill

### AI, export, release

- [x] AI assistant panel (BYOK: OpenAI, Anthropic, Gemini, Ollama, LM Studio) with
      in-place document edits, cross-file changes, and per-change undo
- [x] PDF + standalone HTML export, with a preview surface
- [x] File associations (`.md`, `.markdown`, `.mdown`, `.mkd`), Windows installer (`electron-builder` NSIS), auto-updater
- [x] Unit suite (vitest) + Playwright e2e specs
- [x] README, MIT LICENSE, PRIVACY.md

## v1.1.0 - Next (fix or add)

- [ ] Image resize handles
  - _Acceptance Criteria:_ Drag handles on rendered images set width/height attributes persisted in markdown.
- [ ] Wiki-link autocomplete (sibling files)
  - _Acceptance Criteria:_ Typing `[[` suggests vault/recent/open files across folders; Enter inserts the link.
- [ ] Frontmatter editing
  - _Acceptance Criteria:_ YAML properties editable in the Properties panel and written back to the file header.
- [ ] Reading time in info pill
  - _Acceptance Criteria:_ Pill shows words, characters, and reading time updating live as you type.
- [ ] Formatting keyboard shortcuts
  - _Acceptance Criteria:_ Bold, italic, strikethrough, inline code, and link have default bindings, rebindable in Settings.
- [ ] Vim mode toggle
  - _Acceptance Criteria:_ Settings switch enables Vim keybindings in the editor (`vimMode` key is already reserved in settings).
- [ ] Typewriter mode toggle
  - _Acceptance Criteria:_ Settings switch keeps the active line vertically centered (`typewriterMode` key reserved).
- [ ] Custom CSS injection
  - _Acceptance Criteria:_ CSS pasted in Settings applies to the renderer live (`customCSS` key reserved).
- [ ] Portable mode
  - _Acceptance Criteria:_ Config and vault resolve inside the app folder when enabled (`portableMode` key reserved).
- [ ] Code block language headers
  - _Acceptance Criteria:_ Fenced blocks show detected language with syntax highlighting and a header label.
- [ ] E2E coverage for links and backlinks
  - _Acceptance Criteria:_ `pnpm test:e2e` covers find/replace, the tab strip, links, and backlinks with screenshots. Find/replace and the tab strip are covered today; links and backlinks have no e2e spec.
- [ ] Callout rendering
  - _Acceptance Criteria:_ `> [!note]` and friends render as styled callouts in Live Preview and export. Insertion works; rendering does not exist.
- [ ] Code signing
  - _Acceptance Criteria:_ `electron-builder.yml` signs Windows and macOS builds and notarizes the macOS dmg. Until then `quitAndInstall` fails on macOS.
- [ ] Fix the auto-updater feed
  - _Acceptance Criteria:_ `package.json` has a `repository` field (or `electron-builder.yml` sets `owner`/`repo`), so electron-updater can resolve a release. Also surface check errors instead of rendering them as "up-to-date".
- [ ] Ui for the auto updater.
- [x] Fix settings theme contrast and control consistency.
- [x] Replace settings serif fonts with bundled minimal font choices.

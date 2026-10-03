# Release Notes - v1.2.0

**Features**

- **One Icon Set**: The 74 hand-pasted inline SVGs are replaced by a single 64-glyph module. The same glyph used to be drawn on grids of 8 through 22 at stroke widths from 1.2 to 3, and only 2 of the 74 set round caps, which is why parts of the interface looked heavier than others. Icons now come from Line Awesome by Icons8 (MIT), with the AI glyph from their `nrk_ai-solid-expressive` set, chosen by measuring each candidate against the rest. Menus and the toolbar draw from the same table, so they cannot drift apart again.
- **Quicker Tab Strip**: The strip scrolls instead of clipping tabs past the window edge, reveals the active tab after the node is replaced, and only shows a close button on the tab you are in. Inactive tabs reveal theirs on hover.
- **Editable AI System Prompt Validation**: The prompt and settings that reach the model are now validated against the schema rather than written and ignored.
- **The AI Assistant Panel**: Chat tab, streaming replies (token by token, every provider), a composer that grows with its draft, attachments (dialog or drag & drop), and per-document transcript history. See `AI_PANEL_WORKLOG.md` for the full detail.
- **Working Settings Toggles**: Auto-save, line numbers, and word wrap were drawn in Settings but read by nothing, so three visible switches did nothing. They are wired through, along with highlight-active-line, tab size, and Mermaid. Speculative controls with no reader were removed rather than left dead.

**Bug Fixes**

- **The AI Assistant Panel**: Reasoning-model answers no longer come back empty (`content: null` with text in a `reasoning` field is read too), and gateway error objects in an SSE frame now surface as errors instead of a silent empty delta.
- **Outside Click Closes Popovers**: The model dropdown and the chat history list no longer require clicking their icon again to dismiss - a click anywhere outside the popover closes it.
- **Attachments Actually Read Now**: Picking a file in the attach dialog used to fail with "No handler registered for 'file:read-attachment'" because the running build was stale. The handler ships in the installer now.
- **Drag & Drop Attachments**: Dropped files on the composer ring the accent border and attach like picked ones, through the same size/type guards.

**Motion & Feel**

- **Menus and Dialogs Animate In**: The model dropdown, chat history, context menu, and document menu scale/fade from their anchor corner; the command palette slides in under a fading scrim; the settings dialog pops in. Buttons compress slightly on press. A split pane eases open instead of snapping. All of it is disabled under `prefers-reduced-motion`.

**Bug Fixes**

- **Internal Links Did Nothing**: `[text](notes/other.md)` was handed to the OS shell, which refuses non-web schemes, so clicking a relative link in a document was a silent no-op. Link destinations now resolve against the linking document and open as a tab. Source mode had the same problem, because clicks were matched against rendered decorations it never renders.
- **Conflict Merge Restored the Losing Version**: Resolving a conflict wrote the merged text only to a mirror, never the active tab, so closing the split brought the pre-merge content back and the next save overwrote the merge.
- **The AI API Key No Longer Crosses the Bridge**: Settings now reports whether a key is set and whether it can be decrypted, and substitutes the stored key at request time. Previously the plaintext key was readable from the renderer.
- **Settings No Longer Wipe the Saved Key**: A decrypt failure discarded the stored key and reported success. Writes are now atomic, serialized, and report failure honestly.
- **Three Hardcoded Colours and a Third Surface**: The editor shell painted a background that its own gutter exposed, so the window showed three bands instead of two. All colours across the seven themes are now derived from per-theme seeds.
- **Sandboxed Renderer**: `sandbox: true` was disabled because the preload bridge could not resolve in a sandboxed context. The bridge was simplified, the hidden export window got the same navigation guards as the main window, and permission requests are denied by default.
- **Path and Write Guards**: `save-image` writes atomically, exports validate the path they are handed, the vault path is checked rather than trusted, the vault tree walk has a depth cap against symlink loops, and a dead file watcher now throws instead of looking alive.
- **Registry Writes on Every Launch**: A packaged build rewrote the user's file associations each time it started, through a shell string. It now uses `execFileSync` and only writes when the association is missing.
- **E2E Tests Ran Against Your Real Profile**: The specs launched without a throwaway `userData` dir, so `find.spec.ts` wrote a file into your actual vault. Every spec is now isolated, and one no longer failed whenever `ELECTRON_RUN_AS_NODE` was set in the environment.
- **Source Mode Link Matching**: Clicks in source mode were inert because they matched rendered decorations that source mode does not render. Matching now falls back to the syntax tree without affecting reveal-on-click in the preview.

Commits in this release

- `c289688` Merge remote-tracking branch 'origin/main'
- `963a2db` Merge pull request #7 from fix/project-audit-remediation
- `42ce7cf` fix: link navigation, conflict merge, sandbox, and settings contract
- `5cdb523` fix(tabs): re-observe the strip when the node is replaced
- `b1a05f3` fix(tabs): reveal the close button on hover instead of always
- `6c2c4c2` fix: consolidate icons, derive theme colours, close audit findings
- `3d04146` fix(ui): make the tab strip scroll instead of clipping tabs

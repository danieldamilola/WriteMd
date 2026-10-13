# WriteMd implementation roadmap

The current release baseline is v0.1.0. Release numbering restarted on 2026-10-13 without removing existing features or user data. [CHANGELOG.md](../CHANGELOG.md) contains the active release notes. [The archived roadmap](legacy-phases.md) preserves earlier implementation and verification records.

## Current work

- [ ] Stress-test floating AI auto-accept, long documents, repeated follow-ups, stop/retry, errors, slow saves, tab changes, and chat handoffs. Auto-accept never displays review controls, failed writes release the composer, late callbacks cannot affect a newer request, and edits notify the editor without a debounce. Reject raw provider tool markup rather than displaying or executing it.
- [ ] Add ChatGPT as a separate provider using the official open-source OAuth registration flow and Responses API. Keep credentials in main, encrypt them at rest, validate ID tokens and granted scopes, refresh tokens, and support logout and model discovery. Verify failures and account lifecycle with controlled endpoints, then let the user complete real browser authorization.

- [x] Send complete AI document context without the 120,000-character cutoff. Use small replacements for local edits and a snapshot-checked direct replacement for whole-document rewrites. Hide streamed edit commands, preview only changed passages, and preserve editor selections during incoming edits.
- [x] Recover unusable native tool markup once, including when tools were already disabled. Keep raw markup out of chat, retry DeepSeek without thinking or tools, and leave files unchanged if recovery fails. Verify with the configured live DeepSeek V4 Pro model as well as controlled provider responses.
- [x] Continue the same conversation from the AI side panel through "Open in floating bar", including live responses and saved session identity. Reuse existing AI controls and verify narrow and wide windows in Electron with screenshots.
- [x] Accepted floating-bar edits update the editor synchronously and begin saving without the typing debounce, including when autosave is off. Confirm success only after the write finishes. Preserve newer typing and the original save target during tab switches.
- [x] Committed side-panel edits, accepted external proposals, and undo notify open documents directly. Watch parent directories so successive atomic replacements remain visible. Refresh clean tabs and split panes without stealing focus; preserve dirty buffers and conflict review.
- [x] Reset package metadata, active release notes, About/What's new checks, README, and product documentation to v0.1.0. Preserve old development records as archives. Packaging must derive its version from package.json.

Acceptance requires `pnpm typecheck`, related regression tests, and Electron verification. No commit, push, installer publication, or remote release deletion is part of this change.

## Verification

Native-tool recovery verified on 2026-10-13: reproduced the exact error against the configured live DeepSeek V4 Pro model during a local addition to a generated large note. After the fix, the user's transcript-organization prompt produced and saved an organized replacement for a 140,072-character generated note. A deliberately injected malformed response then recovered through the real DeepSeek API, with tools omitted and thinking disabled, and saved a backlink without changing the organized content. The original user document was not edited or sent by these checks. All 256 related unit tests and four Electron checks passed, including selected-text recovery and the previous large-document regression. Typecheck, production build, related ESLint, Prettier, and whitespace checks passed. Live tests require `WRITEMD_LIVE_AI_TEST=1` and remove copied encrypted credentials when finished.

Screenshots: [organized live result](../artifacts/ui-review/ai-native-tools-live-organized-saved.png), [recovered local addition](../artifacts/ui-review/ai-native-tools-live-preview.png), and [selected-text recovery](../artifacts/ui-review/ai-native-tools-recovered-selection.png).

Long-document fix verified on 2026-10-13: typecheck, production build, and 276 related unit tests passed. Four Electron checks passed, covering a 131,240-character document, a local backlink preview and acceptance with cursor preservation, a direct whole-document rewrite, an incomplete rewrite that leaves the file unchanged, automatic acceptance in both selection modes, and repeated external refreshes. The full unit suite passed 1,203 tests with six skips and nine failures in existing ChatGPT provider-catalog expectations and a preview notification assertion. Those failures are outside this fix. Related ESLint, Prettier, and whitespace checks passed.

The change preview reuses the existing diff markup and theme styles. Screenshots: [local addition](../artifacts/ui-review/ai-large-document-local-preview.png) and [direct rewrite](../artifacts/ui-review/ai-large-document-rewritten.png).

Verified on 2026-10-13: typecheck and production build passed. All 1,185 unit tests passed across 86 files, with six existing skips. Fifteen Electron checks passed against the final build, including floating-bar edits before side-panel article edits with autosave off, automatic acceptance, live conversation handoff in Graphite and Paper, direct commit notifications with the OS watcher disabled, repeated external atomic replacements, split and background documents, and the v0.1.0 What's new dialog. Related ESLint, Prettier, and whitespace checks passed. The release workflow accepts the matching tag and rejects a mismatched version.

The new floating-bar action reuses the AI panel's existing button styles and theme tokens. It has no separate Figma design yet.

Screenshots: [panel action](../artifacts/ui-review/ai-panel-floating-action-graphite.png), [compact Paper action](../artifacts/ui-review/ai-panel-floating-action-paper.png), [accepted floating edit](../artifacts/ui-review/ai-panel-floating-live-paper.png), [external refresh](../artifacts/ui-review/external-file-refresh.png), and [release notes](../artifacts/ui-review/whats-new-changelog.png). Earlier validation records remain in the archived roadmap.

## Baseline scope

The v0.1.0 baseline includes the editor, hybrid vault, tabs and groups, split documents, files and backlinks, export preview and export, seven themes, backgrounds and native materials, Settings, and optional AI across both chat views. [PRD.md](PRD.md) remains the source of truth for product behavior and outstanding scope.

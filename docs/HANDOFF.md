# WriteMd handoff

Saved on 2026-10-13 at the user's request to stop. Development is paused. The current changes are unfinished and uncommitted. No installer was produced, no commit was made, and nothing was pushed.

## User's requested outcome

- Floating bar and side panel must actually edit the requested Markdown file and share their conversation and session.
- Accepted AI edits must update the editor immediately, including files opened outside the vault.
- Auto-accept must hide Accept and Discard, apply changes reliably, and leave Stop and subsequent messages usable. Stress-test the floating bar.
- Prevent raw DeepSeek DSML tool markup from appearing as assistant prose.
- Add ChatGPT account sign-in as a separate provider. The user explicitly approved this.
- Earlier work added OpenRouter, DeepSeek, Groq, Mistral, and xAI, model fetching, settings appearance support, and the release reset to 0.1.0. Preserve that work.
- The latest instruction was to inspect `C:\dev\monocode` for its working authentication and edit flow before spending more time on uncertain implementation.
- The latest screenshot shows an assistant saying "Applied the requested change" after a request to add "Rewritten by DeepSeek", while the visible note still ends with "Written with Gemini 3.8."

## Start with the duplicate-file bug

The user's real configuration contains the same physical note twice in `files.openTabs`:

```text
C:\Users\Daniel\Documents\WriteMd Vault\testing.md
C:/Users/Daniel/Documents/WriteMd Vault/testing.md
```

Only non-secret configuration fields were inspected. Do not print API keys or tokens.

Code inspection found an explanation for the reported success with an unchanged editor:

1. `FileState.openFile` uses an exact path string comparison, so slash aliases can create duplicate tabs.
2. `restoreTabs` does not normalize or deduplicate restored paths.
3. `applyAiEdit` finds the first tab matching `sameFilePath`. It can update and save that tab while the active tab is the second alias.
4. The active editor then continues to display its stale buffer. Refresh also finds the first matching tab, and the own-write echo can return early.

The duplicate configuration and these code paths are confirmed. A regression test and live reproduction of this exact case are still needed. The alias fix has not been implemented.

Fix opening and restoration so each physical file has one tab. Preserve active tab, group, and pin identity. Handle duplicate aliases already present in memory so an AI write cannot update only an inactive copy. Use the existing `sameFilePath` utility. Slash normalization works independently of platform; case comparison tests should use `navigator.platform = 'Win32'`.

Do not rewrite the user's real note merely to demonstrate a test. Use a throwaway note with the same slash-alias setup.

## Monocode inspection

`C:\dev\monocode` exists. File discovery was completed, but the relevant files have not been read:

- `docs/providers.md`
- `host/providers.ts`
- `host/providers.test.ts`
- `host/provider-transport.test.ts`
- `host/provider-guard.mjs`
- `src/integrations/harness/core/authSupport.ts`
- `src/integrations/harness/core/auth.ts`
- `src/integrations/harness/core/auth.test.ts`
- `src/features/providers/model/providerAccounts.ts`
- `src/features/providers/model/providerAccountIdentity.ts`
- `src/features/providers/model/providerAccountCredentials.ts`
- `src/features/providers/model/providerBinaryPaths.ts`

Check applicable AGENTS files before adapting code. Preserve any required attribution. No Monocode implementation has been copied yet.

## Completed baseline before the current unfinished work

The previous completed verification reported 1,185 passing unit tests with 6 skipped, 86 test files, and 15 passing Electron tests. Typecheck and build passed then. Those results do not validate the changes below.

- Package version is 0.1.0. Prior changelog and roadmap were archived in `docs/legacy-changelog.md` and `docs/legacy-phases.md`. Release documentation and the workflow version guard were updated.
- Side panel has "Open in floating bar" and passes the shared conversation/session state.
- Quick AI reads a fresh context snapshot for each new message.
- Accepted floating edits save even with autosave off. File writes are serialized and deduplicated per path.
- Main AI writes emit `file:changed`. A parent-directory watcher survives atomic file replacement.
- Direct refresh bypasses the usual debounce. Stale reads are ignored and newer user typing remains protected by conflict handling.

The working tree contains many changes from earlier tasks, including deleted icons and untracked components/tests. Preserve them. Do not reset or clean the checkout.

## Current unfinished changes

### Floating bar and shared turn state

Changed `src/renderer/src/components/ai/QuickAi.ts`, `turn-controller.ts`, and `App.ts`:

- Auto-accept hides preview cards and applies after the turn is idle.
- Apply callbacks are scoped to the preview object and session, so an old completion cannot settle a newer turn.
- Stop clears local busy/applying state and discards shared previews.
- Apply errors survive later turn-state events.
- Context capture is inside the send try/catch. Each proposal retains the context used when it was requested.
- Focus occurs when expanding, rather than on every update.
- App catches failed applies and reports the error with its preview identity.
- `acceptPreview` uses preview ID when present and object identity otherwise.

One existing Quick AI test clicks Discard while acceptance is still running. Discard is now disabled during application. Adjust the test to finish acceptance or stop the operation, and add tests for the intended lifecycle.

### Immediate content snapshots

Changed shared bridge, preload, main service, IPC, and FileState:

- `FileChangeSnapshot` extends the file-read result and adds `before: string | null`.
- `file.onChanged` can receive the committed content snapshot.
- Apply, preview acceptance, and undo emit snapshots. Normal filesystem changes still use a read.
- `refreshFile(path, snapshot)` can update synchronously without another IPC read.
- A dirty buffer adopts the snapshot only when its current content equals `snapshot.before`. Newer user typing still conflicts.
- FileState notification isolates failing listeners so one subscriber cannot block others or saving.

`tests/ai-preview-accept.test.ts` still expects a one-argument callback and needs the snapshot expectation. Add a test proving synchronous editor notification with no `file.read` call.

### DeepSeek native markup and stalled streams

New `src/main/ai/providers/native-tool-markup.ts` recognizes leading native DSML prefixes, including prefixes split across stream chunks. The OpenAI-compatible adapter holds these prefixes instead of displaying them. If no real structured tool call accompanies the markup, it throws a specific error.

The turn runner permits one retry without tools and asks for an answer based on the supplied note. It does not execute leaked XML or invent web search results.

`streamSse` now accepts `isComplete`. After a terminal provider event, it drains already-buffered events without waiting forever for a provider that leaves the connection open. Verify buffered usage and late errors are preserved. Add a stalled-tail regression.

### ChatGPT account provider

The user authorized a separate ChatGPT sign-in provider. The OpenAI docs skill was read. Official docs describe dynamic registration for local open-source clients, OAuth with PKCE, model discovery, and Responses inference.

New files:

- `src/shared/ai/chatgpt.ts`: renderer-safe account/model/status types.
- `src/main/ai/chatgpt-auth.ts`: encrypted main-process credential storage, loopback OAuth callback, ID token verification, account selection, refresh, and revocation.
- `src/main/ai/providers/chatgpt.ts`: OAuth model catalog and Responses streaming adapter.
- `src/renderer/src/state/chatgpt.ts`: shared account status and catalog without tokens.

Integration changes exist in provider registry/types, service, IPC, preload, shared API/settings schema, SettingsModal, Composer, and ModelPicker. `jose` 6.2.12 was added to package.json and the lockfile.

The implementation uses the official system-browser flow, `dynamic_agent_client` for first registration, a persisted opaque host UUID, a loopback callback, state/nonce/PKCE validation, JOSE signature verification, issued client IDs for returning accounts, and rotating refresh tokens. Tokens remain in the main process and are encrypted through Electron safeStorage. Inference uses `https://api.openai.com/v1/responses` with `store: false`; there is no API-key fallback.

Settings includes Continue with ChatGPT, account selection, add account, sign out, status, Manage usage, and a first-use ChatGPT-plan dialog. Composer shows ChatGPT plan attribution. Existing controls and CSS variables were reused because Settings has no dedicated Figma design.

This implementation is not verified. The live discovery request returned HTTP 502 with `cf_bad_gateway` in this environment. No real sign-in was completed. Do not claim account login or live inference passed.

Known remaining issues:

- Typecheck fails on literal-inferred SettingsStore comparisons. Use explicit `get<string>(...)` in Composer and ModelPicker at the errors below.
- Remove the accidental empty `.text-input {}` rule in SettingsModal.
- `beginLogin` checks cancellation after discovery but needs another generation check after the async server listen, before recording the attempt or opening the browser.
- Check Linux `safeStorage` backend handling so `basic_text` is not treated as secure encryption.
- Logout/account selection calls `cancelAll()` without renderer terminal events. Ensure cancelled visible turns leave busy state.
- Provider registry currently inserts ChatGPT first. Preserve existing default/provider ordering where needed.
- ModelPicker request identity currently does not include the active ChatGPT account. Invalidate pending catalog requests on account changes and preserve provider catalog ordering.
- Check sign-out behavior when tokens exist but consent lacks inference scopes.
- Add dependency license/THIRD_PARTY_NOTICES entries if required by the repository's packaging rules.
- Add auth and Responses adapter tests before claiming completion.

Official references already consulted:

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/token-reference
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/ui-ux-guidelines
- https://api-docs.deepseek.com/guides/tool_calls/

Do not reuse credentials from the user's Codex installation. WriteMd needs its own authorized account flow.

## Last verification state

The last focused run contained 154 tests, with 152 passing and the two expectation failures described above. This run preceded the complete ChatGPT integration.

The last `pnpm typecheck` failed with:

```text
Composer.ts(286,9): TS2367 comparing inferred 'openai' with 'chatgpt'
Composer.ts(814,11): TS2367 comparing inferred '' with 'chatgpt'
ModelPicker.ts(121,23): TS2367 comparing inferred '' with 'chatgpt'
ModelPicker.ts(201,14): TS2367 comparing inferred '' with 'chatgpt'
ModelPicker.ts(251,28): TS2367 comparing inferred '' with 'chatgpt'
```

The node typecheck passed at that point. Further auth cancellation/storage edits followed, so rerun the whole typecheck after repairs. There is no successful final build for the current work. Electron tests would otherwise exercise the previous bundle.

No known shell or agent jobs remain active. No subagents were used.

## Recommended continuation order

1. Read Monocode's applicable guidance and relevant provider/auth code, as the user requested.
2. Repair duplicate file aliases first. Add a regression where the active note is the second slash alias and an AI edit adds "Rewritten by DeepSeek".
3. Resolve the current type errors and the specific lifecycle/auth issues above.
4. Add focused tests for synchronous snapshots, repeated auto-accept, Stop followed by a new request, delayed apply callbacks, failed applies, and native markup split across chunks.
5. Test OAuth state/nonce/PKCE, issued client validation, encrypted persistence, refresh rotation, multiple accounts, logout, cancellation, missing scopes, invalid JWTs, and transient versus terminal refresh failures. Test Responses success, tool calls, reasoning replay, incomplete output, late errors, and model visibility/labels.
6. Build, then stress-test the floating bar in Electron with a throwaway long note. Repeat edits, verify disk and editor immediately after each, switch tabs, stop/restart, and confirm auto-accept never displays review controls. Capture screenshots for visual checks.
7. Run `pnpm typecheck`, touched tests, and the necessary full checks. Update CHANGELOG under Unreleased and the relevant docs. Report exact verified results and any remaining live-provider limitation.

## Repository rules

Read `AGENTS.md`, `docs/PRD.md`, and `docs/phases.md`. Apply the mandatory unslop skill at task start. The available skill file is `C:/Users/Daniel/Documents/WriteMd Vault/Skills/Unslop.md`.

Use strict TypeScript, typed preload access, existing singleton state, CSS variables, and atomic file writes. Do not commit unless asked. Never push. Keep version 0.1.0 unless the user requests a different release version. Do not resume development solely because this handoff exists; the user asked to stop.

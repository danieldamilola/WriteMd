# Changelog

All notable changes to WriteMd are documented here, using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

Release numbering restarts at v0.1.0. Earlier development notes remain in [the archived changelog](docs/legacy-changelog.md).

## [Unreleased]

### Added

- A hardware acceleration switch in Settings → System, with a restart action to apply the saved choice.

### Changed

- Reorganized Settings into writing, workspace, assistant, and application groups. New-note defaults now live with vault and saving options, PDF preferences have an Export page, personal instructions have a Skills page, and performance and resets live in System. Mermaid is under Editor, document-path visibility is under Appearance, and update controls are grouped within About.

## [0.1.0] - 2026-10-16

### Added

- Local Markdown editing with live preview, source and reading modes, tables, code highlighting, and image attachments.
- A default vault for new notes and in-place editing of existing Markdown files anywhere on the computer.
- Tabs, pinned notes, groups, split documents, file browsing, backlinks, search, and keyboard shortcuts.
- PDF, HTML, and Word export with export preview.
- Seven themes, local backgrounds, surface opacity, and supported Windows Mica and Acrylic materials.
- Optional AI with OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Groq, Mistral, xAI, and compatible local providers.
- Shared AI conversations, saved sessions, selections, file references, attachments, personal skills, web search, edit previews, and undo for journaled changes.
- An AI setting to automatically accept completed floating-bar edits.
- An "Open in floating bar" action in the AI side panel that continues the same conversation, including a running response.
- Sign in to ChatGPT with your own account and use your plan, as a provider separate from API keys. Sign-in opens the system browser, supports multiple accounts and rotating refresh tokens, and keeps tokens encrypted in the main process with no API-key fallback.
- Collapsed Space icons open searchable folder cards with nested folders, notes, New note, and New folder while the sidebar stays collapsed.
- Per-model reasoning and service-tier choices in the AI composer and Settings, with supported options sent to each provider and saved separately for each model.
- Provider logos in connection and model pickers, bundled locally and adapted to the active theme.
- A compact Development badge in the title bar identifies local builds and previews in both tab layouts and Settings. Installed release builds hide it.
- OpenCode browser sign-in, workspace model discovery, encrypted credentials, and assistant responses using each model's API format. No API key is needed for this connection.
- ChatGPT accounts can be switched beside the model picker in the AI chat panel. Switching refreshes available models and preserves the unsent prompt.
- Space groups can be nested by dropping one onto another. Drops at a group's edge reorder siblings; Move to Space returns a nested group to the top level. Nested groups persist across restarts and retain their tabs and edits.

### Changed

- Release numbering starts again at v0.1.0. Existing features and saved user settings remain available.
- AI output limits default to Automatic. Compatible providers and Gemini use their own limits; Anthropic uses its required fallback. Custom limits are configurable in AI Settings.
- Accepting a floating-bar edit updates the document and starts an atomic save immediately, even when typing autosave is disabled or delayed.
- Committed AI edits and undo changes notify open documents immediately. External changes refresh without a typing debounce.
- Updated Electron, CodeMirror, Mermaid, Hugeicons, TypeScript, and test tooling. Icon rendering accepts the updated catalogue's readonly data.
- Rewrote the README for the current editor, workspace, AI connections, skills, privacy, and source-build workflow. Removed obsolete screenshots while replacements are prepared, and corrected the linked privacy and skill-size documentation.
- The compact, single-row sidebar update card follows MonoCode's wording: Update to the target version, Downloading with progress, or Restart to update. Upcoming release fixes open on hover or keyboard focus, and the details and Skip action remain accessible while moving into the card.
- Folder cards, update details, and AI option drawers share the existing menu spacing, surfaces, borders, and dismissal behavior.
- The AI panel prompt has a rounded input with Send or Stop inside, and a compact control row beneath for attachments, account switching, and model selection.
- AI settings group provider, credentials, and model under Connection, with edit behavior and history under Conversation. Related controls stay together, skill rows are more compact, and ChatGPT hides its fixed endpoint field.

### Fixed

- The "Using ChatGPT plan" notice disappears once you send a message, instead of sitting above the composer for the rest of the conversation.
- A file reached by two spellings of its path, such as backslashes and forward slashes, opens as one tab instead of two. An AI edit then updates the note you are looking at rather than an invisible copy.
- A note is recognized as a vault file whichever path style it was reached by.
- The ChatGPT provider no longer claims the OpenAI endpoint when a base URL is entered or imported, so a configuration using an API key keeps using that key.
- Switching ChatGPT accounts or signing out no longer leaves a running response with a disabled composer.
- DeepSeek responses that return unusable tool markup retry once without tools and thinking mode, including selection edits. Raw tool markup stays hidden, and failed attempts leave files unchanged.
- AI receives complete documents, selected passages, and referenced files instead of cutting them off at 120,000 characters.
- Small AI edits update and preview only the changed passages. Whole-document rewrites can return the replacement directly without repeating the original, and edit commands stay out of the chat.
- A provider closing its connection after a completion frame no longer fails a completed response. Interrupted responses leave files unchanged and offer a clear retry message.
- Floating AI hides Accept and Discard when automatic acceptance is enabled. Stopping or failing an edit releases the composer, and late save callbacks cannot alter a newer turn.
- Discarding an edit removes it from the shared conversation, preventing it from reappearing after another response or a chat handoff.
- AI updates no longer steal focus from the editor on each render.
- Floating edits keep the conversation open after acceptance and use the accepted text for follow-up requests.
- Article requests produce file edits, including for an empty note. Incomplete or truncated proposals never partially overwrite files.
- File watching survives repeated atomic replacements and refreshes open tabs and split documents without changing the active tab.
- Settings follows the selected theme, opacity, background, and native window appearance.
- Provider model fetching uses the configured provider's catalog rather than inventing unavailable models.
- Gemini tool calls retain their required thought signatures across tool rounds.
- Closing AI Settings releases account listeners, preventing closed settings pages from fetching models after account changes.
- Closing Settings restores keyboard focus to the editor or control that opened it, after the workspace becomes active again.
- Slash suggestions show only installed personal skills, including after leading spaces or newlines. Empty, unavailable, and failed skill discovery no longer fall back to vault files; file references use `@`.
- New notes choose an unused filename instead of selecting another open untitled note or replacing an existing default-named file.
- Escape closes a model-options drawer in Settings before closing the Settings page.
- OpenCode's free-model access restriction is explained directly instead of being presented as an API-key permissions problem.
- Personal skills up to 256 KB load in full, including flat Markdown files larger than the previous 16 KB limit. Oversized-file warnings describe skill instructions rather than always naming SKILL.md.
- ChatGPT sign-in and session renewal can use OpenAI's published production endpoints when discovery returns a gateway error, while retaining identity verification. Other discovery failures still stop the connection.
- Structured ChatGPT authorization errors retain their error codes so unusable refresh credentials trigger a fresh sign-in.

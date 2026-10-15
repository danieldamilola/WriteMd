# Privacy policy

**Last updated:** October 15, 2026

WriteMd is built with a privacy-first, local-first architecture. This Privacy
Policy explains how your data is handled when you use the WriteMd application.
Writing and file management are local. AI requests, provider sign-in, model discovery,
web search, and update checks use the network as described below.

## 1. Local data storage

WriteMd stores notes, settings, and conversation history on your device. New notes use
`~/Documents/WriteMd Vault/` by default; existing files save in their original locations.
WriteMd does not provide cloud storage or synchronization. Content used in AI requests
can leave your device as described below.

## 2. Telemetry and tracking

WriteMd does **not** include telemetry, analytics tracking, or advertising trackers.

## 3. The optional AI assistant

The assistant interface is enabled for new profiles and can be disabled in Settings.
AI generation requires a configured provider and a request from you. You can use an
API key, connect a ChatGPT or OpenCode account through browser sign-in, or use a local
model server. WriteMd sends requests directly to the selected provider or local server.

**What leaves your machine.** When you send a message, WriteMd sends to the
endpoint you configured: your message, the document you have open, your current
selection as appropriate, referenced or attached files, and chat history configured for
replay. A skill you select adds its Markdown instructions. Other open tabs can be listed
by filename as context. Assistant tools can read additional files for your request, and
those results can also be sent to the model. Choosing a local model does not prevent
web search or update checks from using the network.

**Credentials.** Saved API keys and account tokens use Electron's operating-system
encryption support and are stored separately from `config.json`. Stored secrets are
handled in the main process and are not returned to the interface. Credentials are sent
to the provider when needed for authentication. When secure storage is unavailable,
credentials work for the current app session without being saved in plaintext.

Files the assistant changes are written to your disk. Recorded changes have undo
controls in the assistant panel.

**Who sees it.** Whoever operates the endpoint you chose. If you want your notes
to stay on your machine, point the endpoint at a local provider such as Ollama or
LM Studio. WriteMd refuses to send an API key over unencrypted `http://` to a
remote host, but a keyless local endpoint over your LAN is allowed so local models
work.

**File access.** The assistant can read, create, edit and delete any file your
user account can, when you ask it to. It works on files outside the vault too.
Every file it changes is listed in the panel with its own undo button.

## 4. Provider sign-in and web search

Browser sign-in, token refresh, and model discovery contact the selected provider.
Account information and authentication are handled by that provider under its own policies.

The assistant's web search tool sends a query to DuckDuckGo and can return result titles,
links, and snippets to the model. Queries can include information from your request.
The search tool does not fetch the linked result pages.

## 5. Updates

Update checks request release metadata from GitHub, and update downloads fetch the
release files. These requests do not upload your notes. Automatic checks can be
disabled in Settings.

## 6. Changes to this policy

If we add new features that affect how data is handled, we will update this Privacy Policy.

## Contact

If you have any questions or concerns about your privacy while using WriteMd, please open an issue on our GitHub repository.

# Privacy Policy

**Effective Date:** September 20, 2026

WriteMd is built with a privacy-first, local-first architecture. This Privacy
Policy explains how your data is handled when you use the WriteMd application.
Everything is local unless you deliberately turn on the AI assistant, and then
only what you send it leaves your machine.

## 1. Local Data Storage

WriteMd is a local application. All of your notes, documents, and vault settings are stored exclusively on your local device (by default in `~/Documents/WriteMd Vault/`).
We do not have access to your documents, and we do not synchronize, collect, or upload your personal data to any external servers.

## 2. Telemetry and Tracking

WriteMd does **not** include any telemetry, analytics tracking, or advertising trackers. What you write is completely private.

## 3. The Optional AI Assistant

WriteMd has an AI assistant you can turn on. It is **off by default** and does
nothing until you turn it on and enter your own API key. We do not provide the
model and do not proxy your requests.

**What leaves your machine.** When you send a message, WriteMd sends to the
endpoint you configured: your message, the document you have open, your current
selection if there is one, and any files you explicitly referenced with `@` or
attached. Your other open tabs are sent as file names only, never their contents.
Chat history you configured to replay is included.

**What does not leave your machine.** Your API key is stored encrypted with your
operating system's keychain (Windows Credential Manager, macOS Keychain, or
Linux Secret Service) in its own file, never in `config.json` and never readable
by the app's interface. Files the assistant changes are written to your disk
like any other save, and every change it makes can be undone from the assistant
panel.

**Who sees it.** Whoever operates the endpoint you chose. If you want your notes
to stay on your machine, point the endpoint at a local provider such as Ollama or
LM Studio. WriteMd refuses to send an API key over unencrypted `http://` to a
remote host, but a keyless local endpoint over your LAN is allowed so local models
work.

**File access.** The assistant can read, create, edit and delete any file your
user account can, when you ask it to. It works on files outside the vault too.
Every file it changes is listed in the panel with its own undo button.

## 4. Updates

The application occasionally checks GitHub for software updates. This request only sends basic information required to check for new releases (such as your current application version and OS) and does not transmit any personal data. It can be disabled in Settings.

## 5. Changes to this Policy

If we add new features that affect how data is handled, we will update this Privacy Policy.

## Contact

If you have any questions or concerns about your privacy while using WriteMd, please open an issue on our GitHub repository.

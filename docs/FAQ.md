# Frequently Asked Questions

## Where are my files stored?

WriteMd uses a hybrid vault model. By default, new files created in the app are saved to `~/Documents/WriteMd Vault/` (or your configured vault path). However, you can open any markdown file anywhere on your computer, and it will be edited and saved in place. WriteMd never locks you into a proprietary format.

## Does WriteMd require an internet connection?

No! The editor is 100% offline. WriteMd does not have accounts or telemetry. The only outbound requests are the update check against GitHub releases, which can be turned off in Settings, and the AI assistant if you turn it on - which is off by default and sends nothing until you do.

## Can the AI assistant change my files? Is that safe?

Yes, and it is undoable. When you ask it for a change it edits the file on disk, and every file it touches is listed in its panel with its own **Undo** button.

Two rules it follows without being asked. If one of its changes doesn't match the text it expected, it does **not** write that file at all and tells you why, rather than leaving a half-finished rewrite that looks complete. And if you've edited a file yourself since it read it, it skips that file too, so it can't quietly overwrite something you just wrote.

It works on any file your user account can reach, not just files in the vault. That is a deliberate choice, and the Undo list is the reason it is an acceptable one.

To keep your notes on your own machine, point it at a local provider - Ollama or LM Studio - in **Settings > AI assistant**. Nothing then leaves the computer. Your API key is stored encrypted in your operating system's keychain, never in WriteMd's settings file.

## How do I update WriteMd?

WriteMd features a seamless auto-updater. When a new release is available, a "Restart to update" button will appear in the top right corner.

## Is WriteMd open source?

Yes, WriteMd is open source and free to use.

## How do I customize colors or themes?

WriteMd provides several built-in themes (Dark, Light, Paper, etc.). You can switch between them in Settings -> Appearance. All UI and code syntax colors are tied to your chosen theme.

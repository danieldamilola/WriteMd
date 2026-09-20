# WriteMd

A frictionless, minimal markdown editor built with Electron and TypeScript. WriteMd provides a seamless writing experience using a hybrid vault model: new files are saved directly to your vault (`~/Documents/WriteMD/`), while existing files open, edit, and save seamlessly in place. No accounts, no sync, no lock-in.

## Features

- **Live Preview:** Obsidian-style Markdown rendering directly in the editor.
- **Split View:** Work side-by-side with source markdown and real-time preview.
- **AI Assistant:** Bring your own API key (OpenAI, Anthropic, Gemini, local Ollama) to summarize, brainstorm, and rephrase inline.
- **Hybrid Vault:** Keeps your workspace organized but allows you to open external files effortlessly.
- **Command Palette:** Quick fuzzy-search for commands and settings (`Ctrl+P`).
- **Keyboard-First:** Navigate everything without touching a mouse.
- **Themes:** Dark, light, paper, and high-contrast modes.

## Installation

Download the latest release from the [Releases page](https://github.com/writemd-editor/writemd/releases).
Available for Windows, macOS, and Linux.

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Type check
pnpm typecheck

# Run unit tests
pnpm test

# Run E2E tests
pnpm test:e2e

# Build for production
pnpm build
```

## Contributing

See `phases.md` for our current implementation roadmap and `AGENTS.md` for project architecture rules and design guidelines.

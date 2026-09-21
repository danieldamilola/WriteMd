# AGENTS.md — WriteMD Development Guide

## Project Overview

**WriteMD** — Frictionless Markdown Editor. Hybrid vault model: new files go to vault (`~/Documents/WriteMD/`), existing files open/edit/save in place. No accounts, no sync, no lock-in.

**PRD:** `PRD.md` — single source of truth for scope, architecture, and decisions.

**Phases:** `phases.md` — implementation roadmap with acceptance criteria per task.

**Figma Design:** https://www.figma.com/design/ctsfPaeg9sQl7OfXhy4eUT/Projects--UI?node-id=114-127&m=dev

---

## Mandatory Skills

### unslop — ALWAYS ACTIVE

Every response, every code change, every doc edit goes through `unslop` first. Cut AI tells: "Here is...", "This will...", "I'll help...", "Let me...", "Great!", "Excellent!", "Perfect!". No preamble, no postamble, no summaries unless asked. Direct, concise, human-sounding output. If you catch filler while writing, stop, delete, rewrite.

Invoke explicitly at the start of every task:

```
skill: unslop
```

---

## Design Authority

### Figma is the source of truth for visuals

If you are unsure how something should look or behave, open the Figma file before guessing. Match spacing, colors, radius, typography, and interaction patterns exactly as designed.

### When the design is missing

Some screens are not designed yet (menu bar, settings modal, welcome screen, export/conflict/about dialogs). In that case:

1. Study the Figma file for existing patterns (buttons, dialogs, toolbars, spacing rhythm).
2. Follow the project design philosophy: clean, native-feeling, keyboard-first, minimal chrome, no decoration without function.
3. Reuse existing component primitives. Never invent new visual patterns.
4. Use only CSS variables for color. Never hardcode hex values in components.
5. Note the decision in your reply so the design can be formalized in Figma later.

---

## Tech Rules

- Electron + TypeScript strict. No `any`, no `@ts-ignore`.
- Renderer: vanilla TS + Web Components (Lit allowed). No React, no framework tax.
- Editor: CodeMirror 6. Preview parsing: markdown-it. Syntax highlight: Lezer (@codemirror/language) in the editor, custom highlighter in preview.
- Security: `contextIsolation: true`, `nodeIntegration: false`. All Node access through the typed preload bridge (`window.electronAPI`).
- Styling: CSS custom properties only. Themes switch via `[data-theme="..."]`.
- State: file state and settings are singletons with subscribe/notify. No duplicated sources of truth.
- File writes: temp file + atomic rename. Never write directly over the original.
- Vault path defaults to `~/Documents/WriteMD/`. External files always save back to their original location.

---

## Workflow

- Read `phases.md` for the current phase and its acceptance criteria before writing code.
- `pnpm typecheck` must pass before anything is considered done.
- `pnpm test` for touched areas. Add a test when fixing a bug.
- Verify in the running app when the change is visual. Screenshots or it didn't happen.
- Commit only when asked. Never push.

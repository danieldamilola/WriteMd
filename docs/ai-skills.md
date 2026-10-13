# Personal AI skills

Open **Settings > AI assistant > Skills > Open skills folder**.
WriteMd creates a visible `Skills` folder inside your vault when it starts or you change vaults.
Skills stay with that vault.

Put a Markdown file such as `proofread.md` directly in `Skills`, or add a folder such as
`proofread` containing a `SKILL.md`:

```text
Your vault/
  Skills/
    proofread.md
    outline/
      SKILL.md
```

For example, `proofread.md` can contain:

```markdown
---
description: Proofread while preserving my voice
---

Check grammar, spelling, and punctuation.
Preserve my voice and meaning.
Explain the changes. Edit the note only when I ask you to apply them.
Use commas or separate sentences instead of en or em dashes.
```

Type `/` at the start of an AI prompt to select a skill. For example:

```text
/proofread review this note and explain your suggested changes
```

Use **Refresh skills** in Settings after adding files. Chat suggestions and instructions
are read fresh, so editing a skill does not require restarting WriteMd. Only the skill
you explicitly select is sent to your configured AI provider. Ordinary chat and the
Explain/Summarize selection menu do not load personal skills.

A single `Skills/SKILL.md` is also supported, with the command `/skill`.
Skills in the previous `.writemd/skills` folder remain available. When names overlap,
the visible `Skills` folder takes precedence.

Each skill is a Markdown instruction file, up to 16 KB. Folder names use lowercase
letters, numbers, and hyphens, beginning with a letter. WriteMd does not run scripts,
install dependencies, or follow links to folders outside the skills directory. A missing
or unreadable skill produces a chat error so the request does not silently run without it.

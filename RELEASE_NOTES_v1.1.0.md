# Release Notes - v1.1.0

**Features**
* **Export to Word**: One-click `.docx` from the editor note menu and command palette, converted from the same HTML as PDF export. Images in the document embed automatically.
* **Vertical Tabs**: Optional side tab rail (Settings → Appearance → Vertical tabs) with the active tab highlighted and a working close button, matching the Figma vertical layout.
* **Single Top-Bar Row**: In vertical mode the file path, renameable title, reading toggle, and note menu sit in the top bar as one row; the panel below holds only the document.
* **Collapsible Panel**: New toggle beside Settings that hides the side rail so the editor takes the full width.
* **Editable AI System Prompt**: Settings → AI Assistant now has a System Prompt box with Reset to default. The open file's content is still attached automatically.
* **Offline UI Font**: Geist Mono now ships inside the app, so the interface typeface loads with no network. Also selectable as the editor font.
* **Auto-Updates in Settings**: Update checks moved out of the top bar into Settings → About, with check, download progress, and restart-to-update.

**Bug Fixes**
* **Wrong PDF Margins**: Custom margins were sent in pixels instead of inches, producing broken page geometry. They now convert correctly and clamp inside the page.
* **Missing DOCX Images**: Document-relative images came out broken in Word files. They now embed directly.
* **CI Install Failure**: Added the missing workspace package declaration so `pnpm install --frozen-lockfile` passes.
* **Dead Top-Bar Icons**: The reading toggle and note menu sat in the window-drag region and swallowed clicks. They now receive clicks; the note menu opens below the dots button instead of being clipped by the bar.
* **Collapsed Horizontal Layout**: The document strip stretched to fill the panel and squeezed the body into a gap. It now keeps its natural height.
* **Tab Close on Keyboard**: Pressing Enter on the close button also re-selected the tab. Key handling now ignores events bubbled from the button.
* **Welcome Screen Listener Leak**: Detached welcome screens kept receiving settings updates. The subscription now releases on detach.
* **Project-Wide Dashes**: All em/en dashes replaced with hyphens per the unslop style.

Commits in this release

- `14ff774` feat(export): add Word docx export via html-to-docx, mimic Paperling
- `8e50e18` feat(settings): add About section with manual update check, remove TopBar updater button
- `797e589` fix(settings): remove sidebar footer version
- `afd4a10` fix(settings): increase modal height to 700px/90vh
- `a94853f` fix(ui): reduce TopBar to 40px and tab height to 26px
- `b038e3f` fix(ui): remove inner panel border again per request
- `3e4f627` fix(welcome): remove gradient border from buttons
- `ce7da5e` fix(welcome): add subtle drop shadows to buttons
- `6926ce7` feat(vertical-panel): add toggle in Settings for vertical split layout
- `8252a52` docs: add v1.1.0 release notes
- vertical-panel series: welcome screen layout, auto-open panel, sidebar-first, rail + DocBar + collapse toggle, compact fixes, side-by-side splits
- `96faf5b` fix(fonts): self-host Geist Mono so the UI font actually loads
- `e973254` fix(review): CI workspace, PDF margin units, DOCX images, neutral AI ack, tab keys, welcome unsubscribe
- `74ae898` chore: replace em/en dashes with hyphens project-wide
- `43a2cc9` docs: update v1.1.0 release notes for merged vertical panel work

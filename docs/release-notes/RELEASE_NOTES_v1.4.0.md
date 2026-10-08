# Release Notes - v1.4.0

WriteMd 1.4.0 updates the workspace, settings, and welcome screen around a shared layout, with vertical tabs as the default.

**Features**

- **A flatter workspace**: The inner editor frame is gone. Document headers and window controls blend with the editor surface, while the sidebar uses the theme's secondary surface. Document titles stay centered, file paths are visible again, and floating mode and word-count controls are easier to read. Three-dot handles mark where the sidebar and split panes can be resized.
- **Vertical tabs by default**: Open notes, pinned notes, and groups share the sidebar. A short line separates pinned or grouped notes from unpinned notes. Dragging, pinning, grouping, and keyboard reordering use the same behavior in both tab layouts. Horizontal tabs remain available in Appearance.
- **A welcome screen that belongs to the workspace**: Home uses the same sidebar, window controls, and settings entry as the editor. Create a note, open a file, return to one of four recent notes, or open your vault. The layout adapts to smaller windows, both tab orientations, and every theme; opening or closing notes keeps the shared shell in place.
- **Local image backgrounds**: Import artwork for the workspace or AI panel, choose its visibility on empty views or all views, and set separate empty and content strengths. Effects include Haze, Dither, ASCII, Halftone, and Scanlines, alongside the original image. Blur, surface opacity, and supported window materials are separate controls. Imported images are copied into app-owned storage; removing a background leaves the source file alone.
- **Reorganized settings**: Search now lives in the settings sidebar. Writing, Workspace, and Application groups organize clearer category names. Cards, spacing, switches, and custom dropdowns follow the active theme and adapt to compact windows. The New Design beta card and classic-layout switch are removed.
- **Locally bundled fonts**: Inter, Manrope, DM Sans, Space Grotesk, JetBrains Mono, and Geist Mono provide minimal sans-serif and monospace choices without remote font requests. Removed serif and handwritten choices migrate to Manrope.
- **Actions for each split pane**: The second document has its own path, title, reading toggle, menu, and close action. Mode changes, rename, move, export, and find apply to the selected pane.
- **Updates in the vertical sidebar**: Available updates appear above AI Assistant, followed by download progress and Restart to update. Horizontal mode keeps the toolbar update control.

**Bug Fixes**

- Document and text menus fit the viewport, scroll in short windows, and dismiss one another. Submenus support arrow-key navigation, and closing menus restores focus.
- Toolbar and editor colors match at reduced surface opacity. Captions no longer retain a mismatched dark box or visible border.
- Renaming or moving a file updates every open reference, including the split pane, so later saves target the new path without replacing intervening edits.
- Find keeps the selected pane when its search field receives focus.
- Canceling a tab drag leaves order unchanged. Pin and group changes use stable tab identities instead of shifting array indices, and edge scrolling continues while dragging.
- Narrow windows preserve pane constraints, and resizing or rapidly toggling the sidebar settles at the saved size.
- Resetting settings updates subscribers. Queued saves retain the newest snapshot, and failed saves can be retried.
- AI session and stream ownership are separated from editor layout; OpenCode stream events are filtered to the requested session.
- Canceling the file picker or failing to read a file leaves the welcome screen available.

**Upgrade Notes**

- Existing profiles switch to vertical tabs once when the new workspace migration runs. Later explicit orientation choices are retained.
- Removed font choices migrate to Manrope while preserving other editor preferences.
- Files retain WriteMd's existing vault and in-place saving behavior. No accounts or sync are added.

**Documentation**

- Updated the product requirements and implementation tracker, with UI review findings, regression coverage, and screenshots in [UI_REPAIR_IMPLEMENTATION.md](../UI_REPAIR_IMPLEMENTATION.md).
- Added third-party notices for adapted MonoCode and OpenCode code and design patterns.

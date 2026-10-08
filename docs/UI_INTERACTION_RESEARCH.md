# WriteMd interaction research: dragging and resizable frames

Researched 7 October 2026. This follows [the code review](UI_ARCHITECTURE_REVIEW.md) and makes the proposed tab and workspace behavior concrete. No application implementation changed.

OpenCode was inspected at its `dev` branch snapshot [`ecc4916b5a9608c30e6dd58a67f2137b594407ca`](https://github.com/anomalyco/opencode/tree/ecc4916b5a9608c30e6dd58a67f2137b594407ca). This is source inspection, not a claim that every feature has shipped in its released desktop app. Downloaded source references are in [artifacts/ui-review/research](../artifacts/ui-review/research); no repository clone or dependency installation was needed.

## Current drag patterns

There is no single formal standard prescribing a tab animation or collision algorithm. Current toolkit guidance supplies established interaction mechanisms; accessibility guidance supplies requirements. The following is the recommended WriteMd contract drawn from those sources.

| Phase        | WriteMd behavior                                                                                                                    | Basis                                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Press        | A click selects normally. Drag starts after a small distance; close/menu controls cannot start it.                                  | [dnd kit pointer sensor](https://dndkit.com/extend/sensors/pointer-sensor/) supports activation thresholds and excluded interactive targets.                                                        |
| Lift         | Keep the grabbed point attached to the pointer. Show the tab above neighboring content without clipping at the strip boundary.      | [Feedback plugin](https://dndkit.com/extend/plugins/feedback/) provides top-layer feedback and drop animation.                                                                                      |
| Move         | Neighboring tabs move to show the proposed order. Maintain stable identity and a temporary preview order separate from saved order. | [Sortable documentation](https://dndkit.com/concepts/sortable/) covers animations and single/multiple lists. The preview/persistence separation is the WriteMd recommendation.                      |
| Overflow     | Holding near an edge continues scrolling. Speed depends on edge proximity; scrolling updates target geometry.                       | [AutoScroller](https://dndkit.com/extend/plugins/auto-scroller/) documents continuous proximity-based scrolling.                                                                                    |
| Drop         | Commit one ID-based change to order, pin state, and group membership. Settle the visual preview into the accepted destination.      | Current OpenCode's newer tab handler commits by source ID and destination index; WriteMd needs a compound transaction because its pin/group rules are more complex.                                 |
| Cancel       | Escape, pointer cancellation, teardown, or lost ownership removes feedback and restores the pre-drag order.                         | Sortable examples explicitly skip canceled operations; [keyboard sensor](https://dndkit.com/extend/sensors/keyboard-sensor/) includes Escape cancellation.                                          |
| Alternatives | Supply keyboard reordering and clickable Move left/right or Move to group actions.                                                  | [WCAG dragging guidance](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) requires a pointer alternative to dragging; keyboard support alone does not provide that alternative. |

Smoothness includes neighbor displacement, continuous edge scrolling, a stable preview, and interrupted-animation handling. Adding a spring to the existing drag ghost would address only one part.

Internal tab sorting and OS file drops need separate adapters. A pointer-driven sorter gives control over tab gestures; native file drops still use the Electron bridge to resolve and authorize file paths.

### What OpenCode actually uses

The inspected snapshot contains both generations:

- Older file tabs use `@thisbeyond/solid-dnd`, sortable IDs, an overlay, and live reorder on drag-over.
- Newer file tabs use `@dnd-kit/solid` with the shared `@dnd-kit/dom` machinery. They require 4px movement, exclude close/open-in-app controls, constrain dragging horizontally and to the strip, configure edge scrolling, and ignore canceled or unchanged drops before moving by ID.

Sources: [side-panel provider configuration, lines 522–545](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/app/src/pages/session/session-side-panel.tsx#L522-L545), [new sortable tab](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/app/src/components/session/session-sortable-tab-v2.tsx), [old sortable tab](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/app/src/components/session/session-sortable-tab.tsx).

Four pixels is OpenCode's choice, not a universal standard. Its newer provider disables the accessibility plugin and drop animation in this location; WriteMd should define those behaviors for its own interaction contract rather than copy every setting.

### Lit integration changes the adoption plan

The current dnd kit TypeScript API is directly usable without Solid or React. However, `Sortable` enables optimistic sorting by default, which physically moves DOM elements during a drag. That is also a rendering-ownership concern in Lit, not just in SortableJS.

The recommended pilot should disable `OptimisticSortingPlugin`, use a keyed Lit `repeat` list for temporary preview order, and retain dnd kit's sensors, collision detection, feedback, keyboard support, and autoscrolling. WriteMd commits its durable state at drop. Cancel discards the preview. Keep IDs and group metadata synchronized with the rendered list. Explicitly test nested shadow roots and top-layer feedback.

This configuration may require adapting neighbor animation after Lit updates. Either dnd kit or Motion owns a tab's animation transform; both must not animate that property concurrently. The pilot must demonstrate this before broader adoption. [Sortable configuration and optimistic sorting](https://dndkit.com/concepts/sortable/).

## OpenCode's inner frame is resizable

The rounded card/frame and its allocated width are separate concerns. The current session page defines a frame wrapper for background, clipping, corner radius, and elevation. A surrounding pane owns width and the resize handle. The containing row owns padding and gaps.

The row is measured with a resize observer. The pane derives its usable width from that measurement and the neighboring pane's needs. While resizing, width transitions are disabled; programmatic layout changes can animate and reduced motion suppresses those transitions.

Source: [session frame, row measurement, and resize wiring](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/app/src/pages/session.tsx), particularly lines 329–350, 469–507, and 2250–2300.

Other important boundaries:

- A [persisted layout store](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/app/src/context/layout.tsx) owns preferred session/sidebar/file-tree widths and terminal height.
- [Width helpers](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/app/src/pages/session/session-panel-width.ts) derive a rendered width without overwriting the saved preference when the window shrinks. They reserve different room for unified versus split review content instead of imposing a fixed percentage cap.
- A reusable [resize handle](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/ui/src/components/resize-handle.tsx) handles direction, start/end edges, bounds, and collapse thresholds. Its CSS gives it an 8px interaction area with a narrower visible indicator.
- The side panel combines file/review surfaces, and an additional vertical divider resizes a stacked terminal. The layout is more than a single fixed two-column card.

The source also contains limitations worth avoiding: the resize handle itself is mouse-based and supplies no built-in keyboard separator semantics; the width helper preserves a minimum even when both panes cannot fit. WriteMd needs its own compact-mode policy and an accessible splitter. The reference architecture is useful without treating every implementation detail as correct for this editor.

## Proposed WriteMd frame architecture

The inner frame should resize with its pane allocation, and the divider should be operable. Sidebar width, workspace split width, and any future stacked pane height need explicit ownership. The frame's radius and padding should remain design tokens while its dimensions change.

| Owner            | Responsibility                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| App shell        | Title/tab bars, optional rail, window-level commands.                                          |
| Workspace state  | Preferred pane sizes, orientation, visible surfaces, collapsed state, and last expanded sizes. |
| Workspace layout | Measure available space; derive actual sizes, bounds, and compact behavior.                    |
| Splitter adapter | Pointer/keyboard resizing, active-resize lifecycle, collapse/restore, and change events.       |
| Pane frame       | Headers, border/radius, clipping, surface color/opacity; fills the allocated space.            |
| Surface host     | Mounted editor/AI/files content with lifetime independent of geometry changes.                 |
| Tab controller   | One shared drag transaction and preview model for horizontal and vertical presentations.       |

Preferred and rendered sizes must be distinct. If a user chooses a 700px pane and a smaller window can only fit 460px, render 460px temporarily. Restore 700px when space returns. Do not silently replace the preference with 460px. These numbers illustrate the behavior; actual defaults/minimums require WriteMd's content and Figma design.

For a two-pane row, calculate usable width after shell allocation, padding, and gutters. Derive the divider's bounds from both pane minimums. If the minimums cannot fit, switch to a defined compact mode: one active surface with a way to switch, or an auxiliary overlay. Retain the hidden pane's preferred size. Never solve the shortage by clipping controls offscreen.

During pointer resizing, update geometry directly with no spring or CSS width transition. Use Motion for opening, closing, restoring, and settling programmatic changes. Resize observers keep constraints current when the window or rail changes. Save the final preference at gesture completion; avoid disk persistence on every pointer movement.

The splitter should provide a focusable separator with current/bounded values, arrow-key resizing, and collapse/restore behavior. [WAI-ARIA window splitter guidance](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) describes these interactions; the APG also notes that review of this pattern awaits a complete functional example.

CodeMirror's view must remain alive when its pane changes dimensions. Geometry changes update the workspace and editor measurements; they should not recreate the editor or transfer AI stream ownership into the layout.

### Library choice after the research

Use Web Awesome common controls, Motion for programmatic transitions, and pilot dnd kit's DOM API under the ownership rules above. OpenCode combines Kobalte-based tab primitives with its own styling and drag providers; that supports adopting behavior primitives while retaining WriteMd's look. Kobalte's components are Solid-specific, so they are a reference rather than a drop-in Lit dependency.

Evaluate [Web Awesome split panel](https://webawesome.com/docs/components/split-panel/) inside the WriteMd workspace adapter. It supports pixel/percentage positions, primary-panel sizing, bounds, snapping, nested splits, and divider customization. The workspace still owns preferred sizes, compact mode, persistence, and content lifetime. The component does not replace that architecture.

Start with a horizontal resizable workspace and resizable rail. Add stacked arrangements if WriteMd's product needs them. A general IDE docking system with arbitrary floating panels is a separate feature and is unnecessary to provide the requested resizable inner frame.

## Acceptance criteria for the first implementation

1. Existing tab shapes, colors, typography, and spacing are retained.
2. Tabs preview the new order smoothly; overflow scrolling continues without extra mouse movement.
3. Close buttons remain clicks; cancellation preserves saved order; pin/group changes affect the dragged ID only.
4. Both tab orientations use the same transaction and lifecycle. Keyboard and clickable move actions work.
5. The frame follows its pane width while dragging, without delayed CSS/spring sizing.
6. Window or rail resizing clamps the rendered layout; expanding again restores the user's preferred size.
7. When panes cannot fit, compact mode keeps all controls reachable and preserves hidden-pane state.
8. Opening/closing panels preserves text, selection, undo, and AI stream state. Interrupted transitions finish in the latest requested state.
9. Light/dark and reduced-motion checks cover geometry as well as opacity. Restart restores preferred sizes and tab order.

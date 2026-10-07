import { css, html, type TemplateResult } from 'lit'
import { icon } from './icons'

/**
 * Shared dropdown-menu look. Previously hardcoded dark, so menus stayed dark
 * in the light, paper, dracula, nord, graphite and midnight themes.
 */
export const menuStyles = css`
  .m-panel {
    position: absolute;
    min-width: 220px;
    background: var(--menu-bg);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    box-shadow: var(--shadow-3);
    padding: 4px;
    z-index: 100;
  }
  writemd-context-menu > .m-panel {
    position: relative;
    left: auto !important;
    top: auto !important;
    max-width: calc(100vw - 16px);
    max-height: min(85vh, var(--auto-size-available-height, 85vh));
    box-sizing: border-box;
    overflow-y: auto;
  }
  .m-item:focus-visible {
    outline: none;
    background: var(--bg-active);
    color: var(--text);
  }
  .m-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 13px;
    white-space: nowrap;
  }
  .m-item:hover {
    background: var(--bg-active);
    color: var(--text);
  }
  .m-item.danger {
    color: var(--danger);
  }
  .m-item.danger:hover {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .m-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--text-muted);
    display: inline-flex;
  }
  .m-icon svg {
    width: 14px;
    height: 14px;
  }
  .m-divider {
    height: 1px;
    background: var(--bg-hover);
    margin: 4px 6px;
  }
  .m-chevron {
    margin-left: auto;
    padding-left: 16px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .m-check {
    width: 14px;
    flex-shrink: 0;
    color: var(--text);
    display: inline-flex;
  }
  .m-check svg {
    width: 14px;
    height: 14px;
  }
`

/**
 * Menu glyphs come from the shared icon set, which is why a menu item and the
 * same action in the toolbar draw identically. The 14px box is a CSS concern;
 * `icon()` always authors on the 24 grid so the stroke stays proportional.
 */
export function menuIcon(name: string): TemplateResult {
  return html`<span class="m-icon">${icon(name, 14)}</span>`
}

export function menuCheck(): TemplateResult {
  return html`<span class="m-check">${icon('check', 14)}</span>`
}

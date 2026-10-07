import { css } from 'lit'

export const settingsSelectStyles = css`
  wa-select {
    --show-duration: 0ms;
    --hide-duration: 0ms;
    width: 220px;
    max-width: 100%;
    min-width: 0;
    flex: 0 1 220px;
    font-family: var(--font-ui);
  }
  wa-select::part(form-control-label) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  wa-select::part(combobox) {
    min-height: 34px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-hover);
    color: var(--text);
    box-shadow: none;
  }
  wa-select::part(display-input) {
    font: 13px var(--font-ui);
    color: var(--text);
  }
  wa-select::part(listbox) {
    background: var(--menu-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
  }
  wa-option::part(base) {
    font: 13px var(--font-ui);
    padding: 8px 10px;
    color: var(--text);
  }
`

export const resizeHandleStyles = css`
  .resize-handle {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 8px;
    height: 28px;
    color: var(--text-secondary);
    pointer-events: none;
  }
  .resize-handle i {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
  }
`

/** MonoCode's compact controls, adapted for Shadow DOM. MIT; see notices. */
export const controlStyles = css`
  button,
  input,
  select,
  textarea {
    font-family: var(--font-ui);
  }
  button {
    cursor: pointer;
    color: var(--text-secondary);
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  button:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-size: 12px;
    background: transparent;
  }
  .secondary:hover {
    background: var(--bg-active);
    color: var(--text);
  }
  .nav-row {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    text-align: left;
    background: transparent;
    font-size: 14px;
    font-weight: 500;
  }
  .nav-row:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .nav-row[aria-current='page'] {
    background: var(--bg-active);
    color: var(--text);
  }
  svg {
    flex-shrink: 0;
  }
  [hidden] {
    display: none !important;
  }
`

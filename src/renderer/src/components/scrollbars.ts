import { css } from 'lit'

/**
 * Single shared scrollbar look: overlay thumbs that stay invisible until the
 * pane scrolls or is hovered. Shadow DOM blocks the global stylesheet, so
 * every component with a scrollable area includes this fragment instead of
 * redefining its own. Visibility itself is driven by `initAutoHideScrollbars`
 * (`.is-scrolling`); `:hover` covers trackpads, where no scroll event fires
 * until the gesture starts.
 */
export const scrollbarStyles = css`
  * {
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  .is-scrolling,
  :hover {
    scrollbar-color: var(--border) transparent;
  }
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-button {
    display: none;
  }
  ::-webkit-scrollbar-corner {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  .is-scrolling::-webkit-scrollbar-thumb,
  :hover::-webkit-scrollbar-thumb {
    background-color: var(--border);
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--text-muted);
    border: 2px solid transparent;
    background-clip: padding-box;
  }
`

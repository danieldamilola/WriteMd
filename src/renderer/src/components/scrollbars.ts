import { css } from 'lit'

/**
 * Single shared scrollbar look. Shadow DOM blocks the global stylesheet,
 * so every component with a scrollable area includes this fragment instead
 * of redefining its own.
 */
export const scrollbarStyles = css`
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
    background: var(--border);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
    border: 2px solid transparent;
    background-clip: padding-box;
  }
`

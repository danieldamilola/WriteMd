import { EditorView } from '@codemirror/view'
import { Extension } from '@codemirror/state'

export const writeMDTheme: Extension = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 'var(--editor-font-size, 14px)',
    lineHeight: 'var(--editor-line-height, 1.7)',
    height: '100%',
    width: '100%'
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    overflow: 'auto',
    height: '100%',
    display: 'flex',
    justifyContent: 'center'
  },
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px'
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    background: 'transparent'
  },
  '.cm-scroller::-webkit-scrollbar-button': {
    display: 'none'
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: 'var(--border)',
    borderRadius: '4px',
    border: '2px solid transparent',
    backgroundClip: 'padding-box'
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: 'var(--text-muted)',
    border: '2px solid transparent',
    backgroundClip: 'padding-box'
  },
  '.cm-content': {
    caretColor: 'var(--text)',
    padding: '24px 20px 120px 20px',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '760px'
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--text)',
    borderLeftWidth: '2px'
  },
  '&.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection)'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    paddingRight: '12px',
    userSelect: 'none',
    flexShrink: 0
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)'
  },
  /* Headings */
  '.cm-line.cm-live-h1': {
    fontSize: '28px !important',
    fontWeight: '600 !important',
    color: 'var(--syntax-h1) !important',
    lineHeight: '1.3 !important',
    paddingTop: '0.25em !important',
    paddingBottom: '0.15em !important'
  },
  '.cm-line.cm-live-h2': {
    fontSize: '20px !important',
    fontWeight: '600 !important',
    color: 'var(--syntax-h2) !important',
    lineHeight: '1.4 !important',
    paddingTop: '0.2em !important',
    paddingBottom: '0.12em !important'
  },
  '.cm-line.cm-live-h3': {
    fontSize: '17px !important',
    fontWeight: '600 !important',
    color: 'var(--syntax-h3) !important',
    lineHeight: '1.4 !important',
    paddingTop: '0.18em !important',
    paddingBottom: '0.1em !important'
  },
  '.cm-line.cm-live-h4': {
    fontSize: '15px !important',
    fontWeight: '600 !important',
    color: 'var(--syntax-h1) !important',
    lineHeight: '1.4 !important',
    paddingTop: '0.15em !important'
  },
  '.cm-line.cm-live-h5': {
    fontSize: '14px !important',
    fontWeight: '600 !important',
    color: 'var(--text) !important',
    lineHeight: '1.4 !important',
    paddingTop: '0.12em !important'
  },
  '.cm-line.cm-live-h6': {
    fontSize: '13px !important',
    fontWeight: '600 !important',
    color: 'var(--text-muted) !important',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    lineHeight: '1.4 !important',
    paddingTop: '0.1em !important'
  },
  /* Blockquote */
  '.cm-line.cm-live-blockquote': {
    paddingLeft: '14px !important',
    borderLeft: '3px solid var(--border) !important',
    color: 'var(--text-muted) !important'
  },
  /* Fenced code - transparent like table, no box */
  '.cm-line.cm-live-fenced-code': {
    background: 'transparent !important',
    fontFamily: 'var(--font-mono, monospace) !important',
    fontSize: '13px !important',
    paddingLeft: '14px !important',
    paddingRight: '14px !important',
    border: 'none !important',
    boxShadow: 'none !important'
  },
  '.cm-line.cm-live-code-first': {
    border: 'none !important',
    marginTop: '6px !important',
    overflow: 'hidden !important'
  },
  '.cm-line.cm-live-code-last': {
    border: 'none !important',
    marginBottom: '6px !important',
    paddingBottom: '6px !important'
  },
  /* Inline Marks */
  '.cm-live-bold': {
    fontWeight: '700 !important',
    color: 'var(--syntax-bold) !important'
  },
  '.cm-live-italic': {
    fontStyle: 'italic !important',
    color: 'var(--syntax-italic) !important'
  },
  '.cm-live-code': {
    backgroundColor: 'var(--code-bg) !important',
    border: '1px solid var(--border-subtle) !important',
    padding: '1px 5px !important',
    borderRadius: '4px !important',
    fontSize: '13px !important',
    color: 'var(--syntax-code) !important'
  },
  '.cm-live-strike': {
    textDecoration: 'line-through !important',
    color: 'var(--text-muted) !important'
  },
  '.cm-table-toolbar': {
    display: 'flex',
    gap: '4px',
    padding: '4px',
    backgroundColor: '#141414',
    border: '1px solid #2e2e32',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    zIndex: '100'
  },
  '.cm-table-toolbar button': {
    background: 'transparent',
    border: 'none',
    color: '#a3a3a3',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 6px',
    borderRadius: '4px',
    fontFamily: 'inherit',
    fontSize: '12px'
  },
  '.cm-table-toolbar button:hover': {
    background: '#2d2d2d',
    color: '#fff'
  },
  '.cm-tooltip': {
    backgroundColor: 'transparent !important',
    border: 'none !important'
  },
  '.cm-tooltip-autocomplete': {
    backgroundColor: '#141414 !important',
    border: '1px solid #2e2e32 !important',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 8px !important'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: '#2d2d2d !important',
    color: '#fff !important'
  },
  '.cm-live-highlight': {
    backgroundColor: 'rgba(255, 213, 0, 0.2) !important',
    borderRadius: '3px !important',
    color: 'var(--text) !important'
  },
  '.cm-live-hr': {
    display: 'flex !important',
    alignItems: 'center !important',
    minHeight: '24px !important',
    lineHeight: '24px !important',
    border: 'none !important'
  },
  '.cm-live-hr::after': {
    content: "''",
    display: 'block',
    width: '100%',
    height: '1px',
    backgroundColor: 'var(--border-subtle)'
  },
  '.cm-live-link': {
    color: 'var(--accent)',
    textDecoration: 'none',
    cursor: 'pointer'
  },
  '.cm-frontmatter-dim': {
    color: 'var(--text-muted)'
  },
  /* Math and Code Widgets - transparent like table, no box */
  '.cm-live-math': {
    display: 'inline-block',
    cursor: 'pointer',
    padding: '1px 4px',
    borderRadius: '4px',
    background: 'transparent',
    border: 'none',
    color: 'inherit'
  },
  '.cm-live-math-block': {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '16px 8px',
    margin: '8px 0',
    background: 'transparent',
    border: 'none',
    borderRadius: '0',
    position: 'relative',
    fontSize: '1.15em',
    color: 'var(--text)'
  },
  '.cm-math-copy-btn': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'none'
  },
  '.cm-live-math-block:hover .cm-math-copy-btn': {
    display: 'flex'
  },
  '.cm-math-copy-btn:hover': {
    color: 'var(--text)'
  },
  '.cm-math-render': {
    background: 'transparent !important',
    border: 'none !important',
    color: 'inherit'
  },
  '.cm-math-render .katex': {
    color: 'var(--text)',
    background: 'transparent',
    fontSize: '1.05em'
  },
  '.cm-math-render .katex-display': {
    background: 'transparent',
    margin: '0',
    padding: '0'
  },
  '.cm-live-link::after': {
    content: "''",
    display: 'inline-block',
    width: '10px',
    height: '10px',
    marginLeft: '4px',
    verticalAlign: 'baseline',
    cursor: 'pointer',
    backgroundColor: 'var(--syntax-link)',
    maskImage:
      "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/%3E%3Cpolyline points='15 3 21 3 21 9'/%3E%3Cline x1='10' y1='14' x2='21' y2='3'/%3E%3C/svg%3E\")",
    WebkitMaskImage:
      "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/%3E%3Cpolyline points='15 3 21 3 21 9'/%3E%3Cline x1='10' y1='14' x2='21' y2='3'/%3E%3C/svg%3E\")",
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat'
  },
  /* List markers */
  '.cm-live-list-marker': {
    display: 'inline-block',
    width: '1.2em',
    textAlign: 'center',
    userSelect: 'none'
  },
  '.cm-live-bullet': {
    color: 'var(--syntax-list)',
    fontWeight: 'bold'
  },
  '.cm-live-task-checkbox': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    margin: '0 6px 0 0',
    verticalAlign: '-3px',
    border: '1.5px solid var(--text-muted)',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    flexShrink: '0',
    transition: 'background-color 120ms ease, border-color 120ms ease',
    boxSizing: 'border-box'
  },
  '.cm-live-task-checkbox:hover': {
    borderColor: 'var(--text-secondary)'
  },
  '.cm-live-task-checkbox-checked': {
    backgroundColor: 'var(--accent) !important',
    borderColor: 'var(--accent) !important'
  },
  '.cm-live-task-checkbox-checked:hover': {
    backgroundColor: 'var(--accent-hover) !important',
    borderColor: 'var(--accent-hover) !important'
  },
  '.cm-line.cm-live-task-done': {
    textDecoration: 'line-through !important',
    color: 'var(--text-muted) !important'
  },
  /* Table: live preview rendered table */
  '.cm-live-table-wrap': {
    display: 'block',
    margin: '8px 0',
    overflowX: 'auto'
  },
  '.cm-live-table-wrap table': {
    borderCollapse: 'collapse',
    width: 'auto',
    minWidth: '100%',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '14px',
    lineHeight: '1.6'
  },
  '.cm-live-table-wrap th': {
    fontWeight: '600',
    color: 'var(--text)',
    textAlign: 'left',
    padding: '6px 16px 6px 0',
    borderBottom: '1.5px solid var(--border)',
    whiteSpace: 'nowrap'
  },
  '.cm-live-table-wrap td': {
    color: 'var(--text-secondary)',
    textAlign: 'left',
    padding: '5px 16px 5px 0',
    borderBottom: '1px solid var(--border-subtle)',
    verticalAlign: 'top'
  },
  '.cm-live-table-wrap tr:last-child td': {
    borderBottom: 'none'
  },
  '.cm-live-table-wrap td strong, .cm-live-table-wrap td b': {
    color: 'var(--syntax-h3)',
    fontWeight: '600'
  },
  '.cm-live-table-wrap td code': {
    backgroundColor: 'var(--code-bg)',
    padding: '1px 5px',
    borderRadius: '3px',
    fontSize: '13px'
  },
  /* Table: source mode lines break out of max-width and do not wrap */
  '.cm-line.cm-line-table-row': {
    whiteSpace: 'pre !important',
    overflowWrap: 'normal !important',
    wordBreak: 'normal !important',
    maxWidth: 'none !important',
    width: 'max-content !important',
    minWidth: '100% !important',
    boxSizing: 'border-box'
  },
  /* Readonly / Reading mode cursor behavior */
  '.cm-live-readonly .cm-live-link': {
    cursor: 'pointer !important'
  },
  /* Unified Merge / External Changes Diff (matching Image 3) */
  /* Deleted lines (red) */
  '.cm-deletedChunk': {
    backgroundColor: 'rgba(239, 68, 68, 0.12) !important',
    borderLeft: '3px solid #ef4444 !important',
    paddingLeft: '6px !important',
    margin: '1px 0 !important',
    position: 'relative'
  },
  '.cm-deletedLine': {
    color: '#fca5a5 !important',
    fontFamily: 'inherit !important'
  },
  '.cm-deletedLine del': {
    textDecoration: 'none !important',
    color: '#fca5a5 !important'
  },
  '.cm-deletedChunk .cm-deletedText': {
    backgroundColor: 'rgba(239, 68, 68, 0.28) !important',
    borderRadius: '2px',
    color: '#fee2e2 !important'
  },
  '.cm-deletedLineGutter': {
    backgroundColor: 'transparent !important',
    color: '#f87171 !important'
  },
  /* Inserted / Changed lines (green) */
  '.cm-changedLine, .cm-insertedLine, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(34, 197, 94, 0.12) !important',
    borderLeft: '3px solid #22c55e !important'
  },
  '.cm-changedText': {
    backgroundColor: 'rgba(34, 197, 94, 0.28) !important',
    backgroundImage: 'none !important',
    borderRadius: '2px',
    color: '#dcfce7 !important',
    textDecoration: 'none !important'
  },
  '.cm-changedLineGutter': {
    backgroundColor: 'transparent !important',
    color: '#4ade80 !important'
  },
  /* Accept & Reject Buttons */
  '.cm-chunkButtons': {
    display: 'inline-flex !important',
    gap: '6px !important',
    alignItems: 'center !important',
    position: 'absolute !important',
    top: '3px !important',
    right: '8px !important',
    zIndex: '10'
  },
  '.cm-chunkButtons button': {
    fontFamily: 'inherit !important',
    fontSize: '11px !important',
    fontWeight: '600 !important',
    padding: '3px 10px !important',
    borderRadius: '4px !important',
    cursor: 'pointer !important',
    transition: 'all 120ms ease !important',
    boxSizing: 'border-box'
  },
  '.cm-chunkButtons button[name="accept"]': {
    backgroundColor: 'rgba(34, 197, 94, 0.18) !important',
    color: '#4ade80 !important',
    border: '1px solid rgba(34, 197, 94, 0.45) !important'
  },
  '.cm-chunkButtons button[name="accept"]:hover': {
    backgroundColor: 'rgba(34, 197, 94, 0.35) !important',
    borderColor: '#4ade80 !important',
    color: '#ffffff !important'
  },
  '.cm-chunkButtons button[name="reject"]': {
    backgroundColor: 'rgba(239, 68, 68, 0.18) !important',
    color: '#f87171 !important',
    border: '1px solid rgba(239, 68, 68, 0.45) !important'
  },
  '.cm-chunkButtons button[name="reject"]:hover': {
    backgroundColor: 'rgba(239, 68, 68, 0.35) !important',
    borderColor: '#f87171 !important',
    color: '#ffffff !important'
  }
})

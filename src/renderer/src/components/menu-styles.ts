import { css, html, svg, type TemplateResult } from 'lit'

/** Shared dropdown-menu look. Fixed dark card, no theming. */
export const menuStyles = css`
  .m-panel {
    position: absolute;
    min-width: 220px;
    background: #141414;
    border: 1px solid #2e2e32;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 4px;
    z-index: 100;
  }
  .m-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    color: #c9c9c9;
    font-size: 13px;
    white-space: nowrap;
  }
  .m-item:hover {
    background: #2b2b2f;
    color: #ffffff;
  }
  .m-item.danger {
    color: #f87171;
  }
  .m-item.danger:hover {
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
  }
  .m-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: #8a8a8a;
    display: inline-flex;
  }
  .m-icon svg {
    width: 14px;
    height: 14px;
  }
  .m-divider {
    height: 1px;
    background: #2a2a2e;
    margin: 4px 6px;
  }
  .m-spacer {
    flex: 1;
  }
  .m-chevron {
    margin-left: auto;
    padding-left: 16px;
    color: #8a8a8a;
    font-size: 12px;
  }
  .m-check {
    width: 14px;
    flex-shrink: 0;
    color: #ffffff;
    display: inline-flex;
  }
  .m-check svg {
    width: 14px;
    height: 14px;
  }
`

const PATHS: Record<string, TemplateResult> = {
  link: svg`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  external: svg`<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`,
  bold: svg`<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>`,
  italic: svg`<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>`,
  strike: svg`<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>`,
  highlight: svg`<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4z"/>`,
  code: svg`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`,
  math: svg`<path d="M18 4H6l6 8-6 8h12"/>`,
  comment: svg`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  clear: svg`<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
  paragraph: svg`<line x1="6" y1="4" x2="6" y2="20"/><path d="M6 5c5 0 8 2.5 8 6s-3 6-8 6"/>`,
  heading: svg`<path d="M6 4v16"/><path d="M18 4v16"/><line x1="6" y1="12" x2="18" y2="12"/>`,
  quote: svg`<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 1 4 4.5z"/>`,
  insert: svg`<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
  footnote: svg`<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>`,
  table: svg`<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>`,
  callout: svg`<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
  rule: svg`<line x1="5" y1="12" x2="19" y2="12"/>`,
  cut: svg`<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>`,
  copy: svg`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
  paste: svg`<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>`,
  select: svg`<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/>`,
  backlinks: svg`<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H8"/>`,
  eye: svg`<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
  split: svg`<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>`,
  pencil: svg`<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>`,
  folder: svg`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`,
  file: svg`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
  search: svg`<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  reveal: svg`<polygon points="3 11 22 2 13 21 11 13 3 11"/>`,
  trash: svg`<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  check: svg`<polyline points="20 6 9 17 4 12"/>`
}

export function menuIcon(name: string): TemplateResult {
  return html`<span class="m-icon"
    ><svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${PATHS[name] ?? PATHS['rule']}
    </svg></span
  >`
}

export function menuCheck(): TemplateResult {
  return html`<span class="m-check"
    ><svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${PATHS['check']}
    </svg></span
  >`
}

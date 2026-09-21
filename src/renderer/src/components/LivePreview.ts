import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { readOnlyFacet, readOnlyExtension } from './extensions/read-only'
import { treeProgressPlugin } from './extensions/tree-progress'
import { freezeMousePlugin, previewFrozenField } from './extensions/freeze-mouse'
import { insertTightListItem } from './extensions/list-continuation'
import {
  makeLinkClickHandler,
  defaultOnLinkClick,
  documentPathFacet
} from './extensions/link-click'
import { tableLinePlugin } from './extensions/table-line'
import { inlinePreviewPlugin } from './extensions/live-decorations'
import { liveTableField } from './extensions/live-table'

export { readOnlyFacet, readOnlyExtension, documentPathFacet, tableLinePlugin, liveTableField }

export function livePreviewPlugin(config: { onLinkClick?: (url: string) => void } = {}): Extension {
  const { onLinkClick = defaultOnLinkClick } = config
  return [
    liveTableField,
    previewFrozenField,
    inlinePreviewPlugin,
    freezeMousePlugin,
    treeProgressPlugin,
    makeLinkClickHandler(onLinkClick),
    Prec.highest(keymap.of([{ key: 'Enter', run: insertTightListItem }]))
  ]
}

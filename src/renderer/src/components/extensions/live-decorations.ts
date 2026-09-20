import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { Range, Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

import { BULLET_WIDGET } from '../widgets/BulletWidget'
import { TaskCheckboxWidget } from '../widgets/TaskCheckboxWidget'
import { ImageWidget } from '../widgets/ImageWidget'
import { CodeBlockWidget } from '../widgets/CodeBlockWidget'
import { MermaidWidget } from '../widgets/MermaidWidget'
import { readOnlyFacet } from './read-only'
import { previewFrozenField } from './freeze-mouse'
import { treeGrowthEffect } from './tree-progress'
import { documentPathFacet } from './link-click'

export function pushReplace(
  ranges: Range<Decoration>[],
  doc: Text,
  from: number,
  to: number,
  spec: Parameters<typeof Decoration.replace>[0] = {}
): void {
  if (from >= to) return
  const startLine = doc.lineAt(from)
  if (to <= startLine.to) {
    ranges.push(Decoration.replace(spec).range(from, to))
    return
  }
  let cursor = from
  let firstSegment = true
  while (cursor < to) {
    const line = doc.lineAt(cursor)
    const segEnd = Math.min(to, line.to)
    if (segEnd > cursor) {
      ranges.push(Decoration.replace(firstSegment ? spec : {}).range(cursor, segEnd))
      firstSegment = false
    }
    cursor = line.to + 1
  }
}

export const LINE_CLASS_BY_BLOCK: Record<string, string> = {
  ATXHeading1: 'cm-live-h1',
  ATXHeading2: 'cm-live-h2',
  ATXHeading3: 'cm-live-h3',
  ATXHeading4: 'cm-live-h4',
  ATXHeading5: 'cm-live-h5',
  ATXHeading6: 'cm-live-h6',
  SetextHeading1: 'cm-live-h1',
  SetextHeading2: 'cm-live-h2',
  Blockquote: 'cm-live-blockquote',
  FencedCode: 'cm-live-fenced-code'
}

export const HIDEABLE_SYNTAX = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'LinkTitle',
  'StrikethroughMark',
  'HighlightMark',
  'QuoteMark'
])

export const LINK_CHILD_SYNTAX = new Set(['LinkMark', 'URL', 'LinkTitle'])

export const INLINE_MARK_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-live-bold',
  Emphasis: 'cm-live-italic',
  InlineCode: 'cm-live-code',
  Strikethrough: 'cm-live-strike',
  Highlight: 'cm-live-highlight',
  Link: 'cm-live-link'
}

export function linkDestinationUrl(link: SyntaxNode, doc: Text): SyntaxNode | null {
  const labelClose = link
    .getChildren('LinkMark')
    .find((mark) => doc.sliceString(mark.from, mark.to) === ']')
  if (!labelClose) return null
  return link.getChildren('URL').find((url) => url.from >= labelClose.to) ?? null
}

export const LIST_BASE_EM = 0.8
export const LIST_ALCOVE_EM = 1.2
export const LIST_LEVEL_EM = 0.6

export function nearestListItem(node: SyntaxNode | null): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === 'ListItem') return current
  }
  return null
}

export function listItemDepth(item: SyntaxNode): number {
  let depth = 0
  for (let parent = item.parent; parent; parent = parent.parent) {
    if (parent.name === 'ListItem') depth++
  }
  return depth
}

export function sameListItem(a: SyntaxNode | null, b: SyntaxNode): boolean {
  return a?.name === 'ListItem' && a.from === b.from && a.to === b.to
}

export function buildInlineDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const { doc } = state
  const ranges: Range<Decoration>[] = []

  const readOnly = state.facet(readOnlyFacet)
  const activeLines = new Set<number>()
  if (view.hasFocus && !readOnly) {
    for (const r of state.selection.ranges) {
      const firstLine = doc.lineAt(r.from).number
      const lastLine = doc.lineAt(r.to).number
      for (let n = firstLine; n <= lastLine; n++) activeLines.add(n)
    }
  }

  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const activeLinkStarts = new Set<number>()

  tree.iterate({
    enter: (node) => {
      if (node.name === 'FencedCode') {
        const firstLine = doc.lineAt(node.from).number
        const lastLine = doc.lineAt(node.to).number
        let anyActive = false
        for (let n = firstLine; n <= lastLine; n++) {
          if (activeLines.has(n)) {
            anyActive = true
            break
          }
        }
        
        let language = ''
        const codeInfo = node.node.getChild('CodeInfo')
        if (codeInfo) {
          language = doc.sliceString(codeInfo.from, codeInfo.to)
        }
        
        const codeContent = doc.sliceString(node.from, node.to)
          .replace(/^```[^\n]*\n/, '')
          .replace(/\n```\s*$/, '')
          
        if (language === 'mermaid' && (!anyActive || readOnly)) {
          ranges.push(
            Decoration.widget({
              widget: new MermaidWidget(codeContent)
            }).range(node.from)
          )
        } else if (!anyActive && !readOnly) {
          ranges.push(
            Decoration.widget({
              widget: new CodeBlockWidget(language, codeContent)
            }).range(node.from)
          )
        } else if (readOnly) {
          ranges.push(
            Decoration.widget({
              widget: new CodeBlockWidget(language, codeContent)
            }).range(node.from)
          )
        }

        if (anyActive) {
          for (let n = firstLine; n <= lastLine; n++) activeLines.add(n)
        }
      }


      if (node.name === 'Link' && view.hasFocus && !readOnly) {
        for (const range of state.selection.ranges) {
          if (range.from <= node.to && range.to >= node.from) {
            activeLinkStarts.add(node.from)
            break
          }
        }
      }

      const lineClass = LINE_CLASS_BY_BLOCK[node.name]
      if (lineClass) {
        const firstLine = doc.lineAt(node.from)
        const lastLine = doc.lineAt(node.to)
        for (let n = firstLine.number; n <= lastLine.number; n++) {
          const line = doc.line(n)
          if (node.name === 'FencedCode') {
            const classes = [lineClass]
            if (n === firstLine.number) classes.push('cm-live-code-first')
            if (n === lastLine.number) classes.push('cm-live-code-last')
            ranges.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
          } else {
            ranges.push(Decoration.line({ class: lineClass }).range(line.from))
          }
        }
      }

      const markClass = INLINE_MARK_CLASS[node.name]
      if (markClass && node.from < node.to) {
        ranges.push(Decoration.mark({ class: markClass }).range(node.from, node.to))
      }

      if (HIDEABLE_SYNTAX.has(node.name) && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number

        let shouldHide: boolean
        if (LINK_CHILD_SYNTAX.has(node.name)) {
          let parent = node.node.parent
          while (parent && parent.name !== 'Link' && parent.name !== 'Image') {
            parent = parent.parent
          }
          if (parent && parent.name === 'Link') {
            shouldHide = !activeLinkStarts.has(parent.from)
          } else {
            shouldHide = !activeLines.has(lineNum)
          }
        } else {
          shouldHide = !activeLines.has(lineNum)
        }

        if (shouldHide) {
          let hideTo = node.to
          if (node.name === 'HeaderMark' || node.name === 'QuoteMark') {
            while (hideTo < doc.length && doc.sliceString(hideTo, hideTo + 1) === ' ') {
              hideTo++
            }
          }
          pushReplace(ranges, doc, node.from, hideTo)
        }
      }

      if (node.name === 'URL' && node.from < node.to) {
        const parent = node.node.parent
        if (parent?.name === 'Link') {
          const destination = linkDestinationUrl(parent, doc)
          if (destination?.from === node.from && !activeLinkStarts.has(parent.from)) {
            pushReplace(ranges, doc, node.from, node.to)
          }
        } else {
          ranges.push(Decoration.mark({ class: 'cm-live-link' }).range(node.from, node.to))
        }
      }

      if (node.name === 'Escape' && node.to - node.from >= 2) {
        const lineNum = doc.lineAt(node.from).number
        if (!activeLines.has(lineNum)) {
          pushReplace(ranges, doc, node.from, node.from + 1)
        }
      }

      if (node.name === 'ListMark' && node.from < node.to) {
        const line = doc.lineAt(node.from)
        const taskLead = line.text.match(/^(\s*[-*+]\s+)\[[ xX]\]/)
        const taskFrom = taskLead != null ? line.from + taskLead[1].length : undefined

        const listItem = nearestListItem(node.node)
        if (listItem) {
          const depth = listItemDepth(listItem)
          const padding = LIST_BASE_EM + LIST_ALCOVE_EM + depth * LIST_LEVEL_EM
          const firstLine = doc.lineAt(listItem.from)
          const lastLine = doc.lineAt(listItem.to)

          for (let number = firstLine.number; number <= lastLine.number; number++) {
            const ownedLine = doc.line(number)
            const contentOffset = ownedLine.text.search(/\S/)
            if (contentOffset < 0) continue
            const contentFrom = ownedLine.from + contentOffset
            const owner = nearestListItem(tree.resolve(contentFrom, 1))
            if (!sameListItem(owner, listItem)) continue

            const markerLine = ownedLine.number === line.number
            ranges.push(
              Decoration.line({
                attributes: {
                  style: `padding-left: ${padding}em; text-indent: ${
                    markerLine ? `-${LIST_ALCOVE_EM}` : '0'
                  }em`
                }
              }).range(ownedLine.from)
            )
            if (contentFrom > ownedLine.from) {
              pushReplace(ranges, doc, ownedLine.from, contentFrom)
            }
          }
        }

        const hasTrailingSpace = doc.sliceString(node.to, node.to + 1) === ' '
        const markEnd = hasTrailingSpace ? node.to + 1 : node.to

        if (taskFrom !== undefined) {
          pushReplace(ranges, doc, node.from, taskFrom)
        } else {
          const markText = doc.sliceString(node.from, node.to)
          if (markText === '-' || markText === '*' || markText === '+') {
            pushReplace(ranges, doc, node.from, markEnd, { widget: BULLET_WIDGET })
          } else {
            ranges.push(Decoration.mark({ class: 'cm-live-list-marker' }).range(node.from, node.to))
            if (hasTrailingSpace) {
              pushReplace(ranges, doc, node.to, markEnd)
            }
          }
        }
      }

      if (node.name === 'HorizontalRule') {
        const line = doc.lineAt(node.from)
        if (!activeLines.has(line.number)) {
          ranges.push(Decoration.line({ class: 'cm-live-hr' }).range(line.from))
          pushReplace(ranges, doc, line.from, line.to)
        }
      }

      if (node.name === 'Image' && node.from < node.to) {
        const imageLine = doc.lineAt(node.from)
        if (!activeLines.has(imageLine.number)) {
          const raw = doc.sliceString(node.from, node.to)
          const match = raw.match(/^!\[(.*?)\]\((.*?)\)$/)
          if (match) {
            const alt = match[1]
            const src = match[2]
            const docPath = state.facet(documentPathFacet)
            pushReplace(ranges, doc, node.from, node.to, {
              widget: new ImageWidget(src, alt, docPath)
            })
            return false
          }
        }
      }

      if (node.name === 'TaskMarker' && node.from < node.to) {
        const markText = doc.sliceString(node.from, node.to)
        const checked = /\[x\]/i.test(markText)
        const hasTrailingSpace = node.to < doc.length && doc.sliceString(node.to, node.to + 1) === ' '
        const replaceTo = hasTrailingSpace ? node.to + 1 : node.to
        pushReplace(ranges, doc, node.from, replaceTo, {
          widget: new TaskCheckboxWidget(checked)
        })
        if (checked) {
          const lineNum = doc.lineAt(node.from).number
          const line = doc.line(lineNum)
          ranges.push(Decoration.line({ class: 'cm-live-task-done' }).range(line.from))
        }
        return false
      }
      return
    }
  })

  ranges.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from
    const aIsLine = (a.value as any).isLine || false
    const bIsLine = (b.value as any).isLine || false
    if (aIsLine && !bIsLine) return -1
    if (!aIsLine && bIsLine) return 1
    return 0
  })

  return Decoration.set(ranges, true)
}

export const inlinePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view)
    }

    update(update: ViewUpdate): void {
      const prevFrozen = update.startState.field(previewFrozenField)
      const nextFrozen = update.state.field(previewFrozenField)
      const justUnfroze = prevFrozen && !nextFrozen

      if (nextFrozen && !justUnfroze && !update.docChanged) return

      let treeGrew = false
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(treeGrowthEffect)) {
            treeGrew = true
            break
          }
        }
        if (treeGrew) break
      }

      const readOnlyChanged =
        update.startState.facet(readOnlyFacet) !== update.state.facet(readOnlyFacet)

      if (
        justUnfroze ||
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        treeGrew ||
        readOnlyChanged
      ) {
        this.decorations = buildInlineDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
)

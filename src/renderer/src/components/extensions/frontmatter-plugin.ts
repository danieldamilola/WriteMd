import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { StateField, type EditorState } from '@codemirror/state'
import { RangeSetBuilder } from '@codemirror/state'
import { readOnlyFacet } from './read-only'

interface PropertyItem {
  key: string
  value: string | string[]
  type: 'text' | 'tags' | 'object' | 'list'
}

function parseYamlFrontmatter(yaml: string): PropertyItem[] {
  const lines = yaml.split('\n')
  const items: PropertyItem[] = []
  let currentItem: PropertyItem | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('- ') && currentItem && Array.isArray(currentItem.value)) {
      currentItem.value.push(trimmed.slice(2).trim())
      continue
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim()
      const rawVal = line.slice(colonIdx + 1).trim()
      if (!key) continue

      if (!rawVal) {
        currentItem = { key, value: [], type: key.toLowerCase().includes('tag') ? 'tags' : 'list' }
        items.push(currentItem)
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        const parts = rawVal.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        const type = key.toLowerCase().includes('tag') ? 'tags' : 'list'
        currentItem = { key, value: parts, type }
        items.push(currentItem)
      } else if (rawVal.startsWith('{') && rawVal.endsWith('}')) {
        currentItem = { key, value: rawVal, type: 'object' }
        items.push(currentItem)
      } else {
        currentItem = { key, value: rawVal.replace(/^['"]|['"]$/g, ''), type: 'text' }
        items.push(currentItem)
      }
    }
  }

  return items
}

class FrontmatterPropertiesWidget extends WidgetType {
  constructor(
    readonly innerYaml: string,
    readonly endOffset: number
  ) {
    super()
  }

  eq(other: FrontmatterPropertiesWidget): boolean {
    return other.innerYaml === this.innerYaml
  }

  ignoreEvent(): boolean {
    return false
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-frontmatter-widget'
    container.style.background = 'var(--code-bg)'
    container.style.padding = '12px 16px'
    container.style.borderRadius = '6px'
    container.style.border = '1px solid var(--border-subtle)'
    container.style.marginBottom = '16px'
    container.style.cursor = 'pointer'
    container.style.userSelect = 'none'

    // Header
    const header = document.createElement('div')
    header.style.display = 'flex'
    header.style.alignItems = 'center'
    header.style.justifyContent = 'space-between'
    header.style.marginBottom = '10px'

    const title = document.createElement('span')
    title.textContent = 'Properties'
    title.style.fontWeight = '600'
    title.style.fontSize = '13px'
    title.style.color = 'var(--text)'

    header.appendChild(title)
    container.appendChild(header)

    // Properties list
    const properties = parseYamlFrontmatter(this.innerYaml)
    const list = document.createElement('div')
    list.style.display = 'flex'
    list.style.flexDirection = 'column'
    list.style.gap = '8px'

    const textIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`
    const tagIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`
    const objIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`

    for (const prop of properties) {
      const row = document.createElement('div')
      row.style.display = 'flex'
      row.style.alignItems = 'flex-start'
      row.style.minHeight = '24px'
      row.style.gap = '12px'

      // Left column: Icon + Key
      const keyCol = document.createElement('div')
      keyCol.style.display = 'flex'
      keyCol.style.alignItems = 'center'
      keyCol.style.gap = '8px'
      keyCol.style.width = '120px'
      keyCol.style.minWidth = '120px'
      keyCol.style.flexShrink = '0'
      keyCol.style.color = 'var(--text-muted)'

      const iconSpan = document.createElement('span')
      iconSpan.style.display = 'inline-flex'
      iconSpan.style.alignItems = 'center'
      iconSpan.style.opacity = '0.7'
      iconSpan.innerHTML = prop.type === 'tags' ? tagIconSvg : prop.type === 'object' ? objIconSvg : textIconSvg

      const keySpan = document.createElement('span')
      keySpan.textContent = prop.key
      keySpan.style.fontSize = '13px'

      keyCol.appendChild(iconSpan)
      keyCol.appendChild(keySpan)
      row.appendChild(keyCol)

      // Right column: Value
      const valCol = document.createElement('div')
      valCol.style.flex = '1'
      valCol.style.minWidth = '0'
      valCol.style.display = 'flex'
      valCol.style.flexWrap = 'wrap'
      valCol.style.gap = '6px'
      valCol.style.alignItems = 'center'
      valCol.style.color = 'var(--text)'
      valCol.style.fontSize = '13px'
      valCol.style.lineHeight = '1.5'

      if (prop.type === 'tags' && Array.isArray(prop.value)) {
        for (const tag of prop.value) {
          const tagPill = document.createElement('span')
          tagPill.textContent = tag
          tagPill.style.background = 'var(--border-subtle)'
          tagPill.style.padding = '1px 8px'
          tagPill.style.borderRadius = '12px'
          tagPill.style.fontSize = '12px'
          tagPill.style.color = 'var(--text-secondary)'
          valCol.appendChild(tagPill)
        }
      } else if (prop.type === 'object') {
        const codeSpan = document.createElement('span')
        codeSpan.textContent = typeof prop.value === 'string' ? prop.value : JSON.stringify(prop.value)
        codeSpan.style.fontFamily = 'var(--font-mono, monospace)'
        codeSpan.style.color = 'var(--syntax-list, #ffb84d)'
        codeSpan.style.fontSize = '12px'
        valCol.appendChild(codeSpan)
      } else if (Array.isArray(prop.value)) {
        valCol.textContent = prop.value.join(', ')
      } else {
        valCol.textContent = String(prop.value)
      }

      row.appendChild(valCol)
      list.appendChild(row)
    }

    container.appendChild(list)

    // Add property button
    const addBtn = document.createElement('div')
    addBtn.className = 'cm-frontmatter-add'
    addBtn.style.display = 'inline-flex'
    addBtn.style.alignItems = 'center'
    addBtn.style.gap = '6px'
    addBtn.style.marginTop = '10px'
    addBtn.style.color = 'var(--text-muted)'
    addBtn.style.fontSize = '13px'
    addBtn.style.cursor = 'pointer'
    addBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>Add property</span>`

    addBtn.onmouseenter = () => { addBtn.style.color = 'var(--text)' }
    addBtn.onmouseleave = () => { addBtn.style.color = 'var(--text-muted)' }

    addBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      view.dispatch({
        selection: { anchor: this.endOffset },
        scrollIntoView: true
      })
      view.focus()
    }

    container.appendChild(addBtn)

    // Click container to expand YAML for editing
    container.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.cm-frontmatter-add')) return
      view.dispatch({
        selection: { anchor: 4 },
        scrollIntoView: true
      })
      view.focus()
    }

    return container
  }
}

function getFrontmatterDecorations(state: EditorState) {
  const builder = new RangeSetBuilder<Decoration>()
  const readOnly = state.facet(readOnlyFacet)
  const text = state.doc.toString()
  
  if (text.startsWith('---\n')) {
    let endMatch = text.indexOf('\n---\n', 4)
    let endLen = 5
    if (endMatch === -1) {
      if (text.endsWith('\n---')) {
        endMatch = text.length - 4
        endLen = 4
      }
    }

    if (endMatch !== -1) {
      const from = 0
      const to = endMatch + endLen
      
      let active = false
      if (!readOnly) {
        for (const r of state.selection.ranges) {
          // Only expand if cursor is strictly inside the frontmatter text.
          // This prevents auto-expanding when the file is opened (cursor at 0) 
          // or when cursor is immediately after the block.
          const inFrontmatter = (pos: number) => pos > 0 && pos < to
          if (inFrontmatter(r.from) || inFrontmatter(r.to)) {
            active = true
            break
          }
        }
      }
      
      if (!active || readOnly) {
        const innerText = text.substring(4, endMatch)
        const widget = Decoration.replace({
          block: true,
          widget: new FrontmatterPropertiesWidget(innerText, to)
        })
        builder.add(from, to, widget)
      }
    }
  }
  
  return builder.finish()
}

export const frontmatterPlugin = StateField.define<DecorationSet>({
  create(state) {
    return getFrontmatterDecorations(state)
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return getFrontmatterDecorations(tr.state)
    }
    return value
  },
  provide: f => EditorView.decorations.from(f)
})

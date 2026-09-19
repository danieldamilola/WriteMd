import { WidgetType } from '@codemirror/view'

/** Parse inline markdown (bold, italic, code, links) in table cells */
export function parseInlineMarkdown(text: string): string {
  let result = text
  // Code spans (must be first to avoid processing markup inside code)
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')
  // Italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/_(.+?)_/g, '<em>$1</em>')
  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  return result
}

export class TableWidget extends WidgetType {
  constructor(readonly tableText: string) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other.tableText === this.tableText
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-table-wrap'
    wrap.setAttribute('contenteditable', 'false')

    const lines = this.tableText.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length < 2) {
      wrap.textContent = this.tableText
      return wrap
    }

    const parseCells = (line: string): string[] => {
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      return trimmed.split('|').map((c) => c.trim())
    }

    const headerCells = parseCells(lines[0])

    // Parse alignment from separator row
    const sepCells = parseCells(lines[1])
    const aligns: Array<'left' | 'center' | 'right' | ''> = sepCells.map((sep) => {
      const s = sep.trim()
      if (s.startsWith(':') && s.endsWith(':')) return 'center'
      if (s.endsWith(':')) return 'right'
      if (s.startsWith(':')) return 'left'
      return ''
    })

    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    headerCells.forEach((cell, i) => {
      const th = document.createElement('th')
      th.innerHTML = parseInlineMarkdown(cell)
      if (aligns[i]) th.style.textAlign = aligns[i]
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    table.appendChild(thead)

    if (lines.length > 2) {
      const tbody = document.createElement('tbody')
      for (let r = 2; r < lines.length; r++) {
        const cells = parseCells(lines[r])
        const tr = document.createElement('tr')
        headerCells.forEach((_h, i) => {
          const td = document.createElement('td')
          td.innerHTML = parseInlineMarkdown(cells[i] ?? '')
          if (aligns[i]) td.style.textAlign = aligns[i]
          tr.appendChild(td)
        })
        tbody.appendChild(tr)
      }
      table.appendChild(tbody)
    }

    wrap.appendChild(table)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

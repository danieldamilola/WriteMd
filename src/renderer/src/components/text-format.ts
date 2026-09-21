/** Pure string transforms for the text context menu. No DOM, unit tested. */

export function wrapInline(text: string, before: string, after: string = before): string {
  return `${before}${text}${after}`
}

const FORMATTING_PAIRS: Array<[string, string]> = [
  ['**', '**'],
  ['__', '__'],
  ['~~', '~~'],
  ['==', '=='],
  ['``', '``'],
  ['`', '`'],
  ['*', '*'],
  ['_', '_'],
  ['%%', '%%'],
  ['$', '$']
]

/** Strip inline markers and reduce [text](url) to text. */
export function clearFormatting(text: string): string {
  let out = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  let changed = true
  while (changed) {
    changed = false
    for (const [before, after] of FORMATTING_PAIRS) {
      if (
        out.length >= before.length + after.length &&
        out.startsWith(before) &&
        out.endsWith(after)
      ) {
        out = out.slice(before.length, out.length - after.length)
        changed = true
      }
    }
  }
  return out
}

/** Toggle a line prefix like "# " or "> ". Removes on second call. */
export function toggleLinePrefix(line: string, prefix: string): string {
  const trimmed = line.replace(/^\s+/, '')
  const indent = line.slice(0, line.length - trimmed.length)
  if (trimmed.startsWith(prefix)) {
    return indent + trimmed.slice(prefix.length)
  }
  return `${indent}${prefix}${trimmed}`
}

/** Remove heading, quote, and list markers from a line. */
export function stripBlockMarkers(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6}\s+)/, '$1')
    .replace(/^(\s*)>\s?/, '$1')
    .replace(/^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/, '$1')
}

export function tableSkeleton(rows = 3, cols = 3): string {
  const header = `|${' Header |'.repeat(cols)}`
  const sep = `|${' --- |'.repeat(cols)}`
  const body = Array.from({ length: rows }, () => `|${'  |'.repeat(cols)}`).join('\n')
  return `\n${header}\n${sep}\n${body}\n`
}

/** Next free footnote number based on existing [^n] markers. */
export function nextFootnoteNumber(text: string): number {
  const nums = [...text.matchAll(/\[\^(\d+)\]/g)].map((m) => parseInt(m[1], 10))
  return nums.length > 0 ? Math.max(...nums) + 1 : 1
}

export function codeFence(lang = ''): string {
  return `\n\`\`\`${lang}\n\n\`\`\`\n`
}

export function mathBlock(): string {
  return '\n$$\n\n$$\n'
}

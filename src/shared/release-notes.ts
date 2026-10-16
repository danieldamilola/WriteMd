/** electron-updater returns Markdown or a list of notes from a staged update. */
export function updateReleaseNotes(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 65_536)
  if (!Array.isArray(value)) return ''
  return value
    .slice(0, 10)
    .flatMap((entry: unknown) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('note' in entry) ||
        typeof entry.note !== 'string'
      )
        return []
      return [entry.note.slice(0, 65_536)]
    })
    .join('\n\n')
    .slice(0, 65_536)
}

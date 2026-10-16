export const NATIVE_TOOL_MARKUP_ERROR =
  'The model returned native tool markup instead of a usable tool call.'

/** Hold a native protocol prefix until it can be distinguished from prose. */
export function nativeToolPrefix(text: string): 'pending' | 'native' | 'text' {
  const prefix = text.trimStart()
  if (/^<\s*(?:[|｜]\s*){1,2}DSML\b/i.test(prefix)) return 'native'
  if (prefix === '' || /^<\s*(?:[|｜]\s*){0,2}(?:D(?:S(?:M(?:L)?)?)?)?$/i.test(prefix))
    return 'pending'
  return 'text'
}

/** Detect tool markup even after prose, holding fragments so none reach chat. */
export class NativeToolTextGuard {
  private pending = ''
  native = false

  push(delta: string): string {
    if (this.native) return ''
    this.pending += delta
    const marker = /<\s*(?:[|｜]\s*){1,2}DSML\b/i.exec(this.pending)
    if (marker) {
      this.native = true
      const prose = this.pending.slice(0, marker.index)
      this.pending = ''
      return prose
    }
    const start = this.pending.lastIndexOf('<')
    const hold = start >= 0 && nativeToolPrefix(this.pending.slice(start)) === 'pending'
    const prose = hold ? this.pending.slice(0, start) : this.pending
    this.pending = hold ? this.pending.slice(start) : ''
    return prose
  }

  finish(): string {
    const prose = this.native ? '' : this.pending
    this.pending = ''
    return prose
  }
}

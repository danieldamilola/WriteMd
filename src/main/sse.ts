/**
 * Server-sent events, incrementally.
 *
 * Providers stream a chat completion as `data: {json}` frames separated by a
 * blank line. This pulls the JSON payloads out of a byte stream as they arrive
 * so `ipc.ts` can forward each one instead of waiting for the whole answer.
 *
 * Pure and Node-free: `feed` takes decoded text, `ipc.ts` owns the reader.
 */

const DATA_PREFIX = 'data:'
const DONE = '[DONE]'

export class SseParser {
  private buffer = ''

  /**
   * Add decoded text and get back every complete frame in it.
   *
   * Frame boundaries are blank lines, and a chunk can land mid-boundary or even
   * mid-escape, so nothing is parsed until its terminating blank line arrives.
   */
  feed(text: string): unknown[] {
    // Providers disagree on line endings; normalizing to \n makes the blank-line
    // split below the only case that has to work.
    this.buffer += text.replace(/\r\n/g, '\n')
    const payloads: unknown[] = []
    let cut = this.buffer.indexOf('\n\n')
    while (cut !== -1) {
      const frame = this.buffer.slice(0, cut)
      this.buffer = this.buffer.slice(cut + 2)
      payloads.push(...this.parseFrame(frame))
      cut = this.buffer.indexOf('\n\n')
    }
    return payloads
  }

  /**
   * Flush whatever is left once the stream ends. A provider that closes without
   * a trailing blank line would otherwise lose its final frame.
   */
  flush(): unknown[] {
    const rest = this.buffer
    this.buffer = ''
    return rest.trim() ? this.parseFrame(rest) : []
  }

  private parseFrame(frame: string): unknown[] {
    const payloads: unknown[] = []
    for (const line of frame.split('\n')) {
      // Event/id/retry fields carry nothing this client needs.
      if (!line.startsWith(DATA_PREFIX)) continue
      const body = line.slice(DATA_PREFIX.length).trim()
      if (!body || body === DONE) continue
      try {
        payloads.push(JSON.parse(body))
      } catch {
        // A provider can interleave a keep-alive comment or a partial frame.
        // Dropping it is right: the answer is still intact without it.
      }
    }
    return payloads
  }
}

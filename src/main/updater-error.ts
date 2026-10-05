// Turns an electron-updater failure into something a person can act on.
//
// The raw message from GitHubProvider is an HttpError whose `message` carries
// the whole response: the URL, a prose paragraph from GitHub, every response
// header, and then the stack. Settings rendered that verbatim, which put a
// four-kilobyte wall of headers into a 250px sidebar and told the reader
// nothing they could act on. The full text still goes to the log; this is only
// what reaches the screen.

/** One line, no stack, no headers. Falls back to the first sentence. */
function firstLine(message: string): string {
  const line =
    message
      .split('\n')
      .find((part) => part.trim().length > 0)
      ?.trim() ?? ''
  return line
}

export function humanizeUpdaterError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error == null
          ? ''
          : String(error)

  if (!raw.trim()) return 'Update check failed.'

  const lower = raw.toLowerCase()

  // A 404 on latest.yml is the common one, and it is a publishing problem
  // rather than anything the reader did: the release exists but its update
  // metadata was never uploaded.
  if (
    lower.includes('latest.yml') ||
    lower.includes('latest-mac.yml') ||
    lower.includes('latest-linux.yml')
  ) {
    if (lower.includes('404')) {
      return 'The published release is missing its update metadata, so no update can be offered.'
    }
    return 'The published release has unreadable update metadata.'
  }

  if (
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('econnrefused')
  ) {
    return 'Could not reach the update server. Check your internet connection.'
  }

  if (
    lower.includes('etimedout') ||
    lower.includes('esockettimedout') ||
    lower.includes('network')
  ) {
    return 'The connection to the update server timed out.'
  }

  if (
    lower.includes('certificate') ||
    lower.includes('self-signed') ||
    lower.includes('self signed') ||
    lower.includes('unable to verify')
  ) {
    return "The update server's certificate could not be verified."
  }

  if (lower.includes('403') || lower.includes('rate limit')) {
    return 'GitHub is rate-limiting update checks. Try again in a few minutes.'
  }

  if (
    lower.includes('checksum') ||
    lower.includes('sha512') ||
    lower.includes('digest') ||
    lower.includes('corrupt')
  ) {
    return 'The downloaded update did not match its published checksum.'
  }

  if (lower.includes('no published versions') || lower.includes('getaddrinfo enotfound')) {
    return 'No published versions were found for this app.'
  }

  // Anything else: keep the first line only. electron-updater messages are
  // written as a headline followed by detail, so the first line is the part
  // meant for a human.
  const line = firstLine(raw)
  if (!line) return 'Update check failed.'
  return line.length > 160 ? `${line.slice(0, 157)}...` : line
}

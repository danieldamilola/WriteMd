/**
 * Schemes allowed to leave the app through the OS. A `file:` or custom-protocol
 * URL would let a crafted link launch arbitrary content, so this is a short
 * allowlist rather than a blocklist.
 *
 * Lives in `shared/` so the main-process IPC guard and the renderer-side
 * navigation helper enforce the same list. Without that, the renderer would
 * offer a click that the main process then refuses, and the user gets silence.
 */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function isAllowedExternalProtocol(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

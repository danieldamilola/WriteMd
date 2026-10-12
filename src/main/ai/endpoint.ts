/**
 * Endpoint safety.
 *
 * The user configures where their notes get sent, so the check that matters is
 * the one about credentials rather than the one about which hosts are allowed.
 * An API key over plain http to a remote host is the whole secret on the wire,
 * and "it works in curl" is the usual way that gets discovered.
 *
 * Keyless plain http stays allowed deliberately. Ollama and LM Studio on the
 * LAN have no secret to leak, and blocking them would break the local-model
 * case for no security gain.
 */

/** Hosts where plain http never puts bytes on a network. */
export function isLoopbackHost(hostname: string): boolean {
  // URL.hostname keeps IPv6 brackets, so strip them before comparing.
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost') return true
  // RFC 6761 reserves the whole .localhost TLD, so it is always the loopback.
  if (h.endsWith('.localhost')) return true
  if (h === '::1') return true
  // All of 127.0.0.0/8, not just 127.0.0.1.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

export function isValidEndpoint(raw: string): boolean {
  if (!raw || !raw.trim()) return false
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * True when sending `apiKey` to `endpoint` would put it on the wire in clear.
 *
 * A hostname that merely starts with "localhost" is a different host: parsing
 * is what makes `localhost.evil.com` correct here, and a substring check would
 * wave it through.
 */
export function endpointLeaksKey(endpoint: string, apiKey: string | null | undefined): boolean {
  if (!apiKey) return false
  try {
    const url = new URL(endpoint)
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname)
  } catch {
    // An unparseable endpoint cannot be reasoned about. Refusing to guess is the
    // right answer for a question about whether a secret is exposed, and
    // isValidEndpoint rejects the endpoint anyway.
    return true
  }
}

export const INSECURE_KEY_MESSAGE =
  'Refusing to send your API key unencrypted to a remote host. Use an https:// endpoint, or clear the API key if this server does not need one.'

export type EndpointProblem = 'missing' | 'invalid' | 'insecure-key'

export interface EndpointCheck {
  ok: boolean
  problem?: EndpointProblem
  message?: string
}

/**
 * Everything that must hold before a request is dispatched. The renderer calls
 * this for immediate feedback; main calls the same predicates as the actual
 * enforcement point, because the renderer is not a trust boundary.
 */
export function checkEndpoint(
  endpoint: string,
  model: string,
  apiKey: string | null | undefined
): EndpointCheck {
  if (!endpoint || !endpoint.trim()) {
    return {
      ok: false,
      problem: 'missing',
      message: 'AI endpoint not configured. Open Settings to set one up.'
    }
  }
  if (!isValidEndpoint(endpoint)) {
    return {
      ok: false,
      problem: 'invalid',
      message: 'AI endpoint must be a valid http:// or https:// URL.'
    }
  }
  if (endpointLeaksKey(endpoint, apiKey)) {
    return { ok: false, problem: 'insecure-key', message: INSECURE_KEY_MESSAGE }
  }
  if (!model || !model.trim()) {
    return { ok: false, problem: 'missing', message: 'AI model not configured.' }
  }
  return { ok: true }
}

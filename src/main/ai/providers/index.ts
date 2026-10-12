import type { ProviderKind } from '../../../shared/ai/types'
import { anthropicAdapter, anthropicDescriptor } from './anthropic'
import { geminiAdapter, geminiDescriptor } from './gemini'
import { openaiAdapter, openaiDescriptor } from './openai'
import type { ProviderAdapter, ProviderDescriptor } from './types'

/**
 * The registry.
 *
 * `ADAPTERS` is keyed by wire kind because that is the only thing that decides
 * how a request is shaped. Everything else - the label, the default URL, whether
 * a key is needed - belongs to a descriptor, and a descriptor is data. Ollama and
 * LM Studio are therefore descriptors with no adapter of their own: they speak
 * the OpenAI-compatible `/v1` shape, and the only difference is where the URL
 * points.
 */

export const ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter
}

/**
 * A local server. No key, no account, and the default URL is the documented one,
 * which is the entire reason this preset exists - typing the URL by hand is the
 * first thing anyone does with a local model and the first thing anyone gets
 * wrong.
 */
const ollamaDescriptor: ProviderDescriptor = {
  id: 'ollama',
  label: 'Ollama',
  kind: 'openai',
  defaultBaseUrl: 'http://localhost:11434/v1',
  defaultModel: 'llama3.2',
  keyRequired: false,
  keyHint: 'Local server on port 11434. No API key needed.'
}

const lmStudioDescriptor: ProviderDescriptor = {
  id: 'lmstudio',
  label: 'LM Studio',
  kind: 'openai',
  defaultBaseUrl: 'http://localhost:1234/v1',
  defaultModel: 'local-model',
  keyRequired: false,
  keyHint: 'Local server on port 1234. No API key needed.'
}

export const PRESETS: ProviderDescriptor[] = [
  openaiDescriptor,
  anthropicDescriptor,
  geminiDescriptor,
  ollamaDescriptor,
  lmStudioDescriptor
]

/** The adapter a preset id routes to, or null for an id nothing claims. */
export function adapterFor(descriptorId: string): ProviderAdapter | null {
  const preset = PRESETS.find((candidate) => candidate.id === descriptorId)
  return preset ? ADAPTERS[preset.kind] : null
}

/**
 * Guess which preset a hand-typed base URL belongs to.
 *
 * Used when a provider is added by URL rather than by picking a preset, which is
 * the path taken when settings are imported or migrated. Returns null rather than
 * a best guess: an unmatched URL is a normal outcome - a proxy, a gateway, a
 * self-hosted model - and guessing wrong would silently route a request to the
 * wrong API with the wrong headers.
 */
export function matchPresetByBaseUrl(url: string): ProviderDescriptor | null {
  const target = normalizeUrl(url)
  if (!target) return null
  const exact = PRESETS.find((preset) => normalizeUrl(preset.defaultBaseUrl) === target)
  if (exact) return exact
  // A trailing path segment or two - `/v1/chat/completions`, a copied cURL URL -
  // is still the same server. Matching on a `/` boundary stops `/v1beta` from
  // being read as a prefix of `/v1beta-elsewhere`.
  return (
    PRESETS.find((preset) => {
      const candidate = normalizeUrl(preset.defaultBaseUrl)
      if (!candidate) return false
      return target.startsWith(`${candidate}/`) || candidate.startsWith(`${target}/`)
    }) ?? null
  )
}

/** Trim, lowercase the host, drop trailing slashes and any query or fragment. */
function normalizeUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}`.toLowerCase()
  } catch {
    // Not a URL. Compared verbatim so a config with a placeholder in it still
    // has a chance, and so this never throws out of a settings render.
    return trimmed.replace(/\/+$/, '').toLowerCase()
  }
}

export type { ProviderAdapter, ProviderConfig, ProviderDescriptor, StreamRequest } from './types'
export { anthropicAdapter, geminiAdapter, openaiAdapter }
export { openaiDescriptor, anthropicDescriptor, geminiDescriptor }

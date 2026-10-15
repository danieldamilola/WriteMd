export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
export type ServiceTier = 'default' | 'priority'
export interface ModelPreference {
  reasoning: ReasoningEffort | 'auto'
  serviceTier: ServiceTier | 'auto'
}
export type ModelPreferences = Record<string, ModelPreference>
export interface ModelCapabilities {
  reasoning: ReasoningEffort[]
  serviceTiers: ServiceTier[]
}
export interface ModelOptions {
  reasoning?: ReasoningEffort
  serviceTier?: ServiceTier
}
export const DEFAULT_MODEL_PREFERENCE: ModelPreference = { reasoning: 'auto', serviceTier: 'auto' }
export const REASONING_LABELS: Record<ReasoningEffort | 'auto', string> = {
  auto: 'Provider default',
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}
export const SERVICE_TIER_LABELS = {
  auto: 'Provider default',
  default: 'Standard',
  priority: 'Fast'
}
export function modelPreferenceKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}
export function validModelPreferences(value: unknown): value is ModelPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    Object.entries(value).length <= 500 &&
    Object.entries(value).every(([key, raw]) => {
      if (key.length > 1024 || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false
      try {
        const identity: unknown = JSON.parse(key)
        if (
          !Array.isArray(identity) ||
          identity.length !== 2 ||
          !identity.every((part) => typeof part === 'string')
        )
          return false
      } catch {
        return false
      }
      const item = raw as Record<string, unknown>
      return (
        Object.keys(item).every((name) => name === 'reasoning' || name === 'serviceTier') &&
        (item.reasoning === 'auto' ||
          REASONING_EFFORTS.includes(item.reasoning as ReasoningEffort)) &&
        ['auto', 'default', 'priority'].includes(String(item.serviceTier))
      )
    })
  )
}
export function modelPreference(
  preferences: unknown,
  provider: string,
  model: string
): ModelPreference {
  return validModelPreferences(preferences)
    ? (preferences[modelPreferenceKey(provider, model)] ?? DEFAULT_MODEL_PREFERENCE)
    : DEFAULT_MODEL_PREFERENCE
}

/** Conservative API capabilities. Unknown models keep provider defaults. */
export function modelCapabilities(provider: string, model: string): ModelCapabilities {
  const id = model.toLowerCase().replace(/^.*\//, '')
  const result: ModelCapabilities = { reasoning: [], serviceTiers: [] }
  if (provider === 'openai' || provider === 'chatgpt') {
    if (/^(gpt-|o[134](?:-|$))/.test(id)) result.serviceTiers = ['default', 'priority']
    if (/^gpt-6(?:\.|-)/.test(id))
      result.reasoning = /^(gpt-6-sol|gpt-6-luna)(?:-|$)/.test(id)
        ? ['none', 'low', 'medium', 'high', 'xhigh', 'max']
        : ['low', 'medium', 'high', 'xhigh', 'max']
    else if (/^gpt-5\.6(?:-|$)/.test(id))
      result.reasoning = ['low', 'medium', 'high', 'xhigh', 'max']
    else if (/^gpt-5\.[2-5](?:-|$)/.test(id))
      result.reasoning = ['none', 'low', 'medium', 'high', 'xhigh']
    else if (/^gpt-5\.1(?:-|$)/.test(id)) result.reasoning = ['none', 'low', 'medium', 'high']
    else if (/^gpt-5(?:-|$)/.test(id)) result.reasoning = ['minimal', 'low', 'medium', 'high']
    else if (/^o[134](?:-|$)/.test(id) && id !== 'o1-mini' && !id.includes('pro'))
      result.reasoning = ['low', 'medium', 'high']
  } else if (provider === 'deepseek' && /^(deepseek-flash|deepseek-v4-pro)(?:-|$)/.test(id)) {
    result.reasoning = ['none', 'low', 'high', 'max']
  } else if (provider === 'anthropic' && /^claude-/.test(id)) {
    if (/(opus-4-[5-8]|sonnet-4-6|(?:opus|sonnet|haiku|mythos|fable)-5)/.test(id)) {
      result.reasoning = ['low', 'medium', 'high']
      if (!id.includes('opus-4-5')) result.reasoning.push('max')
      if (/(opus-4-[78]|(?:opus|sonnet|haiku|mythos|fable)-5)/.test(id))
        result.reasoning.splice(3, 0, 'xhigh')
    }
  } else if (provider === 'gemini' && /^gemini-3(?:\.|-)/.test(id)) {
    result.reasoning = /^gemini-3\.8-flash/.test(id)
      ? ['low', 'medium', 'high']
      : /flash-lite-image/.test(id)
        ? ['minimal', 'high']
        : id.includes('flash')
          ? ['minimal', 'low', 'medium', 'high']
          : ['low', 'high']
  } else if (provider === 'gemini' && /^gemini-4-argon/.test(id)) {
    result.reasoning = ['low', 'medium', 'high']
  } else if (provider === 'groq' && id.startsWith('gpt-oss-'))
    result.reasoning = ['low', 'medium', 'high']
  return result
}
export function supportedModelOptions(
  preference: ModelOptions,
  capabilities: ModelCapabilities
): ModelOptions {
  return {
    ...(preference.reasoning && capabilities.reasoning.includes(preference.reasoning)
      ? { reasoning: preference.reasoning }
      : {}),
    ...(preference.serviceTier && capabilities.serviceTiers.includes(preference.serviceTier)
      ? { serviceTier: preference.serviceTier }
      : {})
  }
}
export function preferenceOptions(preference: ModelPreference): ModelOptions {
  return {
    ...(preference.reasoning !== 'auto' ? { reasoning: preference.reasoning } : {}),
    ...(preference.serviceTier !== 'auto' ? { serviceTier: preference.serviceTier } : {})
  }
}

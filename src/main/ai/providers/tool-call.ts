import type { ToolCall } from '../../../shared/ai/types'
import { asRecord, normalizeModelIds } from './http'

/**
 * Tool-call assembly.
 *
 * Every provider streams tool arguments as partial JSON: `{"path":"a/no` then
 * `tes/x.md","search":"` then `...`. Emitting those fragments is useless - the
 * runner cannot parse half an argument object - so the fragments are buffered
 * per call and only become a `ToolCall` once the provider says that call is
 * finished. The alternative, parsing early and emitting often, fails in the one
 * place it matters: a fragment that happens to be valid JSON would execute.
 */

/**
 * Marker key for a call whose arguments did not parse.
 *
 * Carried inside `arguments` rather than thrown, because the model chose that
 * shape and the runner will turn the call into an error either way. Discarding
 * the whole turn because one call came back malformed loses the text the model
 * wrote alongside it, which is usually the part the user can still use.
 */
export const TOOL_ARGS_ERROR_KEY = '__invalid_arguments'

export interface ToolCallPatch {
  id?: string | null
  name?: string | null
  /** Argument fragments accumulate; id and name overwrite. */
  args?: string | null
  extraContent?: Record<string, unknown> | null
}

export function finalizeToolCall(partial: { id: string; name: string; args: string }): ToolCall {
  const trimmed = partial.args.trim()
  if (!trimmed) return { id: partial.id, name: partial.name, arguments: {} }
  try {
    const parsed = asRecord(JSON.parse(trimmed) as unknown)
    if (parsed) return { id: partial.id, name: partial.name, arguments: parsed }
    return {
      id: partial.id,
      name: partial.name,
      arguments: { [TOOL_ARGS_ERROR_KEY]: 'Tool arguments must be a JSON object.' }
    }
  } catch {
    return {
      id: partial.id,
      name: partial.name,
      arguments: {
        [TOOL_ARGS_ERROR_KEY]: `Tool arguments were not valid JSON: ${trimmed.slice(0, 200)}`
      }
    }
  }
}

/** Fragments keyed by whatever the provider calls the call: index, block id. */
export class ToolCallBuffer {
  private readonly order: string[] = []
  private readonly parts = new Map<
    string,
    { id: string; name: string; args: string; extraContent?: Record<string, unknown> }
  >()

  add(key: string, patch: ToolCallPatch): void {
    const existing = this.parts.get(key)
    if (existing) {
      if (patch.id) existing.id = patch.id
      if (patch.name) existing.name = patch.name
      if (patch.args) existing.args += patch.args
      if (patch.extraContent) existing.extraContent = patch.extraContent
      return
    }
    const entry = {
      id: patch.id ?? '',
      name: patch.name ?? '',
      args: patch.args ?? '',
      ...(patch.extraContent ? { extraContent: patch.extraContent } : {})
    }
    this.parts.set(key, entry)
    this.order.push(key)
  }

  get size(): number {
    return this.order.length
  }

  /** Finalize one call, if its fragments are all in. */
  flushKey(key: string): ToolCall | null {
    const entry = this.parts.get(key)
    if (!entry) return null
    this.parts.delete(key)
    this.order.splice(this.order.indexOf(key), 1)
    return {
      ...finalizeToolCall(entry),
      ...(entry.extraContent ? { extraContent: entry.extraContent } : {})
    }
  }

  /** Finalize everything still buffered, in arrival order. */
  flushAll(): ToolCall[] {
    const calls: ToolCall[] = []
    for (const key of [...this.order]) {
      const call = this.flushKey(key)
      if (call) calls.push(call)
    }
    return calls
  }
}

/**
 * Read `data[].id` out of an OpenAI-shaped model list, which is also what
 * Anthropic returns. Shared by both adapters; `normalizeModelIds` sorts and
 * dedupes so the picker order does not depend on the provider's response order.
 */
export function readDataModelIds(payload: unknown): string[] {
  const data = asRecord(payload)?.data
  if (!Array.isArray(data)) return []
  const ids: string[] = []
  for (const entry of data) {
    const id = asRecord(entry)?.id
    if (typeof id === 'string') ids.push(id)
  }
  return normalizeModelIds(ids)
}

import type { OpenCodeAuthView, OpenCodeModelView } from '../../../shared/ai/opencode'
import { modelCapabilities, supportedModelOptions } from '../../../shared/ai/model-options'
import {
  openCodeAuth,
  OPENCODE_API_BASE,
  OPENCODE_CONSOLE,
  OPENCODE_ORIGIN
} from '../opencode-auth'
import { asRecord, asString, requestJson, throwIfAborted } from './http'
import { openaiAdapter } from './openai'
import { anthropicAdapter } from './anthropic'
import { geminiAdapter } from './gemini'
import { streamResponses } from './responses'
import type { ProviderAdapter, ProviderDescriptor, StreamRequest } from './types'

export const openCodeDescriptor: ProviderDescriptor = {
  id: 'opencode',
  label: 'OpenCode',
  kind: 'openai',
  defaultBaseUrl: OPENCODE_API_BASE,
  defaultModel: '',
  keyRequired: false,
  keyHint: 'Sign in with your OpenCode workspace',
  selectableByUrl: false
}

type WireKind = 'openai' | 'responses' | 'anthropic' | 'gemini'
interface Route extends OpenCodeModelView {
  model: string
  baseUrl: string
  kind: WireKind
  providerId: string
}

function wireKind(packageName: unknown): WireKind | null {
  switch (typeof packageName === 'string' ? packageName.replace(/^aisdk:/, '') : '') {
    case '@ai-sdk/openai-compatible':
      return 'openai'
    case '@ai-sdk/openai':
      return 'responses'
    case '@ai-sdk/anthropic':
      return 'anthropic'
    case '@ai-sdk/google':
      return 'gemini'
    default:
      return null
  }
}

/** Only the official gateway can receive the Console credential. */
function gatewayBase(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (
      url.origin !== OPENCODE_ORIGIN ||
      !url.pathname.startsWith('/inference/') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function openCodeRoutes(config: unknown): Route[] {
  const providers = asRecord(asRecord(config)?.providers)
  const routes: Route[] = []
  for (const [providerId, raw] of Object.entries(providers ?? {})) {
    const provider = asRecord(raw)
    const models = asRecord(provider?.models)
    const providerSettings = asRecord(provider?.settings)
    for (const [id, entry] of Object.entries(models ?? {})) {
      const model = asRecord(entry)
      if (!model || model.disabled === true) continue
      const kind = wireKind(model.package ?? provider?.package)
      const baseUrl = gatewayBase(asRecord(model.settings)?.baseURL ?? providerSettings?.baseURL)
      const modelId = asString(model.modelID) ?? id
      if (!kind || !baseUrl || !modelId.trim() || /[\s?#\\]/.test(modelId)) continue
      const output = asRecord(asRecord(model.capabilities)?.output)
      if (output?.text === false) continue
      const underlying =
        kind === 'responses'
          ? 'openai'
          : kind === 'anthropic' || kind === 'gemini'
            ? kind
            : providerId
      const options = modelCapabilities(underlying, modelId)
      // Console entitlements determine gateway speed. Never send a direct API billing tier.
      options.serviceTiers = []
      routes.push({
        id: `${encodeURIComponent(providerId)}/${encodeURIComponent(id)}`,
        label: `${asString(model.name) ?? id} · ${asString(provider?.name) ?? providerId}`,
        model: modelId,
        baseUrl,
        kind,
        providerId: underlying,
        options
      })
    }
  }
  return routes
}

interface Account {
  state(): OpenCodeAuthView
  accessToken(): Promise<string>
}

export class OpenCodeCatalog {
  private routes: Route[] = []
  private connection: string | null = null
  private loadedAt = 0
  constructor(private readonly account: () => Account = openCodeAuth) {}

  private async load(signal: AbortSignal): Promise<Route[]> {
    const account = this.account()
    const token = await account.accessToken()
    throwIfAborted(signal)
    const connection = account.state().connectionId
    const config = await requestJson(`${OPENCODE_CONSOLE}/api/v2/config`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'WriteMd' },
      signal
    })
    if (!connection || account.state().connectionId !== connection || !account.state().connected)
      throw new Error('OpenCode account changed. Load models again.')
    const routes = openCodeRoutes(config)
    if (!routes.length)
      throw new Error('No supported text models are available in this OpenCode workspace.')
    this.routes = routes
    this.connection = connection
    this.loadedAt = Date.now()
    return routes
  }

  async models(signal: AbortSignal): Promise<OpenCodeModelView[]> {
    return (await this.load(signal)).map(({ id, label, options }) => ({ id, label, options }))
  }

  async *stream(request: StreamRequest): ReturnType<ProviderAdapter['stream']> {
    const account = this.account()
    const connection = account.state().connectionId
    if (connection !== this.connection || Date.now() - this.loadedAt > 300_000)
      await this.load(request.signal)
    const route = this.routes.find((route) => route.id === request.model)
    if (!route) throw new Error('This OpenCode model is unavailable. Fetch models in AI Settings.')
    const token = await account.accessToken()
    throwIfAborted(request.signal)
    if (!connection || account.state().connectionId !== connection || !account.state().connected)
      throw new Error('OpenCode account changed. Send your message again.')
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'WriteMd',
      ...(account.state().workspaceId ? { 'x-opencode-org-id': account.state().workspaceId! } : {}),
      ...(request.sessionId ? { 'x-opencode-session': request.sessionId } : {})
    }
    const routed: StreamRequest = {
      ...request,
      baseUrl: route.baseUrl,
      model: route.model,
      providerId: route.providerId,
      modelOptions: supportedModelOptions(
        request.modelOptions ?? {},
        route.options ?? { reasoning: [], serviceTiers: [] }
      ),
      apiKey: undefined,
      gatewayHeaders: headers
    }
    if (route.kind === 'responses') yield* streamResponses(routed, headers, 'OpenCode')
    else
      yield* { openai: openaiAdapter, anthropic: anthropicAdapter, gemini: geminiAdapter }[
        route.kind
      ].stream(routed)
  }
}

export const openCodeCatalog = new OpenCodeCatalog()
export const openCodeAdapter: ProviderAdapter = {
  descriptor: openCodeDescriptor,
  async listModels(_config, signal) {
    return (await openCodeCatalog.models(signal)).map((model) => model.id)
  },
  stream: (request) => openCodeCatalog.stream(request)
}

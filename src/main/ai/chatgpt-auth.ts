import { app, safeStorage, shell } from 'electron'
import { createServer, type Server, type ServerResponse } from 'http'
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { asRecord, asString } from './providers/http'
import type { ChatgptAuthView } from '../../shared/ai/chatgpt'

export const CHATGPT_API_BASE = 'https://api.openai.com/v1'
const AUTH_ORIGIN = 'https://auth.openai.com'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'

interface Tokens {
  accessToken: string
  refreshToken: string
  idToken: string
  scopes: string[]
  expiresAt: number
  earliestRefreshAt: number
}
interface Account {
  clientId: string
  subject: string
  email: string
  welcomed: boolean
  tokens: Tokens | null
}
interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  revocation_endpoint?: string
}

// Published production endpoints: https://developers.openai.com/siwc/website
// Discovery remains preferred. Its gateway can fail while these routes work.
const PUBLISHED_DISCOVERY: Discovery = {
  issuer: AUTH_ORIGIN,
  authorization_endpoint: `${AUTH_ORIGIN}/api/accounts/authorize`,
  token_endpoint: `${AUTH_ORIGIN}/api/accounts/oauth/token`,
  jwks_uri: `${AUTH_ORIGIN}/.well-known/jwks.json`
}

class AuthHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
interface Attempt {
  server: Server
  state: string
  nonce: string
  verifier: string
  redirectUri: string
  selected: Account | null
  controller: AbortController
  timeout: ReturnType<typeof setTimeout>
  exchanging: boolean
}
interface AuthOptions {
  directory: string
  openBrowser: (url: string) => Promise<void>
  encrypt: (text: string) => Buffer | null
  decrypt: (data: Buffer) => string | null
  fetcher?: typeof fetch
}

/** Owns registered accounts and OAuth credentials exclusively in main. */
export class ChatgptAuth {
  private accounts: Account[] = []
  private activeId: string | null = null
  private hostId: string
  private attempt: Attempt | null = null
  private starting = false
  private loginGeneration = 0
  private keys: ReturnType<typeof createRemoteJWKSet> | null = null
  private error: string | null = null
  private sessionOnly = false
  private listeners = new Set<(state: ChatgptAuthView) => void>()
  private discovery: Promise<Discovery> | null = null
  private refreshes = new Map<string, Promise<Tokens>>()
  private fetcher: typeof fetch

  constructor(private options: AuthOptions) {
    this.fetcher = options.fetcher ?? fetch
    mkdirSync(options.directory, { recursive: true })
    const hostPath = join(options.directory, 'chatgpt-host-id')
    const saved = existsSync(hostPath) ? readFileSync(hostPath, 'utf8').trim() : ''
    this.hostId = /^urn:uuid:[0-9a-f-]{36}$/i.test(saved) ? saved : `urn:uuid:${randomUUID()}`
    if (saved !== this.hostId) this.atomic(hostPath, this.hostId)
    this.load()
  }

  private atomic(path: string, data: string | Buffer): void {
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, data, { mode: 0o600 })
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  private load(): void {
    const path = join(this.options.directory, 'chatgpt-auth')
    if (!existsSync(path)) return
    try {
      const plain = this.options.decrypt(readFileSync(path))
      if (!plain) throw new Error('unavailable')
      const data = asRecord(JSON.parse(plain) as unknown)
      if (data?.version !== 1 || !Array.isArray(data.accounts)) throw new Error('invalid')
      for (const value of data.accounts) {
        const account = asRecord(value)
        if (
          !account ||
          typeof account.clientId !== 'string' ||
          account.clientId === 'dynamic_agent_client' ||
          typeof account.subject !== 'string' ||
          typeof account.email !== 'string'
        )
          continue
        const stored = asRecord(account.tokens)
        const tokens =
          stored &&
          typeof stored.accessToken === 'string' &&
          typeof stored.refreshToken === 'string' &&
          typeof stored.idToken === 'string' &&
          typeof stored.expiresAt === 'number' &&
          Number.isFinite(stored.expiresAt) &&
          Array.isArray(stored.scopes) &&
          stored.scopes.every((scope) => typeof scope === 'string')
            ? {
                accessToken: stored.accessToken,
                refreshToken: stored.refreshToken,
                idToken: stored.idToken,
                expiresAt: stored.expiresAt,
                earliestRefreshAt:
                  typeof stored.earliestRefreshAt === 'number' ? stored.earliestRefreshAt : 0,
                scopes: stored.scopes as string[]
              }
            : null
        this.accounts.push({
          clientId: account.clientId,
          subject: account.subject,
          email: account.email,
          welcomed: account.welcomed === true,
          tokens
        })
      }
      this.activeId = this.accounts.some((account) => account.clientId === data.activeId)
        ? String(data.activeId)
        : null
    } catch {
      this.error = 'This install cannot read the saved ChatGPT connection. Sign in again.'
    }
  }

  private save(): void {
    let encrypted: Buffer | null = null
    try {
      encrypted = this.options.encrypt(
        JSON.stringify({ version: 1, activeId: this.activeId, accounts: this.accounts })
      )
    } catch {
      /* Keep credentials in memory when the OS keychain is unavailable. */
    }
    this.sessionOnly = encrypted === null
    if (encrypted) this.atomic(join(this.options.directory, 'chatgpt-auth'), encrypted)
    else rmSync(join(this.options.directory, 'chatgpt-auth'), { force: true })
  }

  private active(): Account | null {
    return this.accounts.find((account) => account.clientId === this.activeId) ?? null
  }

  state(): ChatgptAuthView {
    const account = this.active()
    const connected =
      !!account?.tokens?.scopes.includes('chatgpt.tokens.use.direct') &&
      account.tokens.scopes.includes('resource.invoke')
    return {
      connected,
      pending: this.starting || this.attempt !== null,
      activeId: this.activeId,
      accounts: this.accounts.map((account, index) => ({
        id: account.clientId,
        label: `${account.email || 'ChatGPT account'} · Account ${index + 1}`
      })),
      error: this.error,
      sessionOnly: this.sessionOnly,
      needsWelcome: connected && !account?.welcomed
    }
  }

  subscribe(listener: (state: ChatgptAuthView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(): void {
    for (const listener of this.listeners) listener(this.state())
  }

  private metadata(): Promise<Discovery> {
    this.discovery ??= this.json(`${AUTH_ORIGIN}/.well-known/openid-configuration`)
      .then((data) => {
        if (data.issuer !== AUTH_ORIGIN)
          throw new Error('ChatGPT sign-in returned an unexpected issuer.')
        const result: Discovery = {
          issuer: AUTH_ORIGIN,
          authorization_endpoint: '',
          token_endpoint: '',
          jwks_uri: ''
        }
        for (const field of [
          'authorization_endpoint',
          'token_endpoint',
          'jwks_uri',
          'revocation_endpoint'
        ] as const) {
          const value = asString(data[field])
          if (!value && field === 'revocation_endpoint') continue
          if (!value || new URL(value).origin !== AUTH_ORIGIN)
            throw new Error('ChatGPT sign-in returned an unexpected endpoint.')
          result[field] = value
        }
        return result
      })
      .catch((error: unknown) => {
        this.discovery = null
        // Fall back only for discovery gateway failures, never for rejected or
        // malformed metadata. Retry discovery on the next operation. There is
        // no published revocation fallback; logout reports that limitation.
        if (error instanceof AuthHttpError && [502, 503, 504].includes(error.status))
          return { ...PUBLISHED_DISCOVERY }
        throw error
      })
    return this.discovery
  }

  private async json(
    url: string,
    body?: URLSearchParams,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: body ? 'POST' : 'GET',
        ...(body
          ? {
              body: body.toString(),
              headers: { 'content-type': 'application/x-www-form-urlencoded' }
            }
          : {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        redirect: 'error'
      })
    } catch {
      throw new Error('Could not reach ChatGPT sign-in. Try again.')
    }
    const payload = asRecord(await response.json().catch(() => null))
    if (!response.ok) {
      const code = asString(payload?.error) ?? asString(asRecord(payload?.error)?.code)
      throw new AuthHttpError(
        code && /^[a-z_]{1,80}$/.test(code)
          ? `ChatGPT authorization failed: ${code}`
          : `ChatGPT sign-in is unavailable (${response.status}). Try again.`,
        response.status
      )
    }
    if (!payload) throw new Error('ChatGPT sign-in returned an invalid response.')
    return payload
  }

  async login(addAccount = false): Promise<ChatgptAuthView> {
    this.cancelLogin()
    const generation = this.loginGeneration
    this.starting = true
    this.error = null
    this.notify()
    try {
      return await this.beginLogin(addAccount, generation)
    } finally {
      if (this.loginGeneration === generation) {
        this.starting = false
        this.notify()
      }
    }
  }

  private async beginLogin(addAccount: boolean, generation: number): Promise<ChatgptAuthView> {
    const metadata = await this.metadata()
    if (this.loginGeneration !== generation) throw new Error('ChatGPT sign-in was cancelled.')
    const selected = addAccount ? null : this.active()
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    const verifier = randomBytes(64).toString('base64url')
    const server = createServer((request, response) => {
      void this.callback(request.method ?? '', request.url ?? '', response).catch(() => {
        if (!response.writableEnded)
          response.writeHead(500).end('Sign-in could not finish. Return to WriteMd and try again.')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Could not start the ChatGPT callback.')
    }
    // Checked again because binding the port is an await. A cancel that landed
    // while it was in flight must not leave a live attempt registered or send
    // the user to a browser for a sign-in that is already abandoned.
    if (this.loginGeneration !== generation) {
      server.close()
      throw new Error('ChatGPT sign-in was cancelled.')
    }
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`
    const attempt: Attempt = {
      server,
      state,
      nonce,
      verifier,
      redirectUri,
      selected,
      controller: new AbortController(),
      exchanging: false,
      timeout: setTimeout(
        () => {
          if (this.attempt === attempt) {
            this.cancelLogin()
            this.error = 'ChatGPT sign-in timed out. Try again.'
            this.notify()
          }
        },
        10 * 60 * 1000
      )
    }
    attempt.timeout.unref()
    server.unref()
    this.attempt = attempt
    this.error = null
    const url = new URL(metadata.authorization_endpoint)
    url.search = new URLSearchParams({
      client_id: selected?.clientId ?? 'dynamic_agent_client',
      ext_agent_host_id: this.hostId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: CHATGPT_API_BASE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      ...(selected
        ? {
            ...(selected.tokens ? { id_token_hint: selected.tokens.idToken } : {}),
            ...(selected.email ? { login_hint: selected.email } : {}),
            ...(!selected.tokens?.scopes.includes('chatgpt.tokens.use.direct')
              ? { prompt: 'consent' }
              : {})
          }
        : { agent_name_hint: 'WriteMd' })
    }).toString()
    this.notify()
    try {
      await this.options.openBrowser(url.toString())
    } catch {
      this.cancelLogin()
      throw new Error('Could not open the browser for ChatGPT sign-in.')
    }
    return this.state()
  }

  cancelLogin(): ChatgptAuthView {
    this.loginGeneration++
    const starting = this.starting
    this.starting = false
    if (this.attempt) {
      this.attempt.controller.abort()
      clearTimeout(this.attempt.timeout)
      this.attempt.server.close()
      this.attempt.server.closeAllConnections()
      this.attempt = null
      this.notify()
    }
    if (starting) this.notify()
    return this.state()
  }

  private async callback(method: string, rawUrl: string, response: ServerResponse): Promise<void> {
    const attempt = this.attempt
    const url = new URL(rawUrl, 'http://127.0.0.1')
    if (method !== 'GET' || url.pathname !== '/auth/callback') {
      response.writeHead(404).end()
      return
    }
    const state = url.searchParams.get('state') ?? ''
    if (
      !attempt ||
      attempt.exchanging ||
      Buffer.byteLength(state) !== Buffer.byteLength(attempt.state) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(attempt.state))
    ) {
      response.writeHead(400).end('Invalid sign-in state.')
      return
    }
    attempt.exchanging = true
    try {
      if (url.searchParams.has('error'))
        throw new Error('ChatGPT sign-in was declined or cancelled.')
      const clientId = url.searchParams.get('client_id') ?? attempt.selected?.clientId
      if (
        !clientId ||
        clientId === 'dynamic_agent_client' ||
        clientId.length > 512 ||
        (attempt.selected && clientId !== attempt.selected.clientId)
      )
        throw new Error('ChatGPT registration returned an unexpected client ID.')
      const code = url.searchParams.get('code')
      if (!code) throw new Error('ChatGPT registration did not return an authorization code.')
      const metadata = await this.metadata()
      const result = await this.json(
        metadata.token_endpoint,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: attempt.verifier,
          redirect_uri: attempt.redirectUri,
          resource: CHATGPT_API_BASE
        }),
        attempt.controller.signal
      )
      const idToken = asString(result.id_token)
      if (!idToken) throw new Error('ChatGPT sign-in did not return an identity token.')
      const identity = await this.identity(idToken, clientId, attempt.nonce)
      if (attempt.selected && identity.sub !== attempt.selected.subject)
        throw new Error('A different ChatGPT account was returned. Use Add account instead.')
      const tokens = this.tokens(result)
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return
      const account = this.accounts.find((account) => account.clientId === clientId)
      if (account && account.subject !== identity.sub)
        throw new Error('ChatGPT registration changed its account identity.')
      const registered: Account = {
        clientId,
        subject: identity.sub!,
        email: typeof identity.email === 'string' ? identity.email : '',
        welcomed: account?.welcomed ?? false,
        tokens
      }
      if (account) this.accounts[this.accounts.indexOf(account)] = registered
      else this.accounts.push(registered)
      this.activeId = clientId
      this.error = tokens.scopes.includes('chatgpt.tokens.use.direct')
        ? null
        : 'Sign-in succeeded, but ChatGPT plan use was not authorized. Continue with ChatGPT to enable it.'
      this.save()
      response
        .writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store'
        })
        .end('Signed in. You can return to WriteMd.')
    } catch (error) {
      if (this.attempt !== attempt) return
      this.error = error instanceof Error ? error.message : 'ChatGPT sign-in could not finish.'
      response
        .writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        .end('Sign-in could not finish. Return to WriteMd for details.')
    } finally {
      if (this.attempt === attempt) {
        clearTimeout(attempt.timeout)
        attempt.server.close()
        this.attempt = null
        this.notify()
      }
    }
  }

  private async identity(
    token: string,
    clientId: string,
    nonce?: string
  ): Promise<Awaited<ReturnType<typeof jwtVerify>>['payload']> {
    const metadata = await this.metadata()
    try {
      const keys = (this.keys ??= createRemoteJWKSet(new URL(metadata.jwks_uri), {
        [customFetch]: this.fetcher
      }))
      const { payload } = await jwtVerify(token, keys, {
        issuer: metadata.issuer,
        audience: clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
        algorithms: ['RS256', 'ES256']
      })
      if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce))
        throw new Error('identity')
      return payload
    } catch {
      throw new Error('ChatGPT identity verification failed. Start sign-in again.')
    }
  }

  private tokens(data: Record<string, unknown>, previous?: Tokens): Tokens {
    const accessToken = asString(data.access_token)
    const refreshToken = asString(data.refresh_token) ?? previous?.refreshToken
    const idToken = asString(data.id_token) ?? previous?.idToken
    const expires = data.expires_in
    const scope = asString(data.scope)
    if (
      !accessToken ||
      !refreshToken ||
      !idToken ||
      typeof expires !== 'number' ||
      !Number.isFinite(expires) ||
      expires <= 0 ||
      (asString(data.token_type) ?? '').toLowerCase() !== 'bearer'
    )
      throw new Error('ChatGPT returned incomplete credentials. Sign in again.')
    const earliest = data.earliest_refresh_at
    return {
      accessToken,
      refreshToken,
      idToken,
      expiresAt: Date.now() + expires * 1000,
      scopes: scope !== null ? scope.split(/\s+/).filter(Boolean) : (previous?.scopes ?? []),
      earliestRefreshAt:
        typeof earliest === 'number'
          ? earliest * 1000
          : typeof earliest === 'string'
            ? Date.parse(earliest) || 0
            : 0
    }
  }

  async accessToken(): Promise<string> {
    const account = this.active()
    if (!account?.tokens || !this.state().connected)
      throw new Error('Continue with ChatGPT in AI Settings before starting a chat.')
    let tokens = account.tokens
    if (Date.now() >= Math.max(tokens.expiresAt - 60000, tokens.earliestRefreshAt)) {
      let refreshing = this.refreshes.get(account.clientId)
      if (!refreshing) {
        refreshing = this.refresh(account, tokens).finally(() =>
          this.refreshes.delete(account.clientId)
        )
        this.refreshes.set(account.clientId, refreshing)
      }
      tokens = await refreshing
    }
    if (this.active() !== account || !account.tokens)
      throw new Error('The ChatGPT account changed. Send the request again.')
    if (Date.now() >= tokens.expiresAt)
      throw new Error('ChatGPT access has expired and cannot renew yet. Try again later.')
    if (
      !tokens.scopes.includes('chatgpt.tokens.use.direct') ||
      !tokens.scopes.includes('resource.invoke')
    )
      throw new Error('ChatGPT plan use is not authorized. Sign in again in AI Settings.')
    return tokens.accessToken
  }

  private async refresh(account: Account, previous: Tokens): Promise<Tokens> {
    try {
      const metadata = await this.metadata()
      const result = await this.json(
        metadata.token_endpoint,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: account.clientId,
          refresh_token: previous.refreshToken,
          resource: CHATGPT_API_BASE
        })
      )
      const tokens = this.tokens(result, previous)
      if (
        result.id_token &&
        (await this.identity(tokens.idToken, account.clientId)).sub !== account.subject
      )
        throw new Error('ChatGPT refresh returned a different account.')
      if (account.tokens !== previous)
        throw new Error('The ChatGPT session changed while renewing. Sign in again.')
      account.tokens = tokens
      this.save()
      this.notify()
      return tokens
    } catch (error) {
      if (
        error instanceof Error &&
        /(?:invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused)$/.test(
          error.message
        )
      ) {
        if (account.tokens === previous) {
          account.tokens = null
          this.save()
          this.error = 'ChatGPT sign-in expired. Continue with ChatGPT again.'
          this.notify()
        }
      }
      throw error
    }
  }

  select(clientId: string): ChatgptAuthView {
    if (!this.accounts.some((account) => account.clientId === clientId))
      throw new Error('Unknown ChatGPT account.')
    this.cancelLogin()
    this.activeId = clientId
    this.error = null
    this.save()
    this.notify()
    return this.state()
  }

  acknowledgePlan(): ChatgptAuthView {
    const account = this.active()
    if (account) {
      account.welcomed = true
      this.save()
      this.notify()
    }
    return this.state()
  }

  async logout(): Promise<ChatgptAuthView> {
    this.cancelLogin()
    const account = this.active()
    const tokens = account?.tokens
    if (!account || !tokens) return this.state()
    account.tokens = null
    this.error = null
    this.save()
    this.notify()
    try {
      const metadata = await this.metadata()
      if (!metadata.revocation_endpoint) throw new Error('no revocation endpoint')
      const response = await this.fetcher(metadata.revocation_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        body: new URLSearchParams({
          client_id: account.clientId,
          token: tokens.refreshToken,
          token_type_hint: 'refresh_token'
        }).toString()
      })
      if (!response.ok) throw new Error('revocation failed')
    } catch {
      this.error =
        'Signed out locally. Remote sign-out was not confirmed. Disconnect WriteMd in ChatGPT Settings.'
    }
    this.notify()
    return this.state()
  }
}

/**
 * Whether safeStorage will actually keep the tokens secret.
 *
 * On Linux with no keyring, Electron falls back to the `basic_text` backend,
 * which stores the "encrypted" bytes as a plainly reversible string and still
 * reports `isEncryptionAvailable() === true`. Writing account tokens through it
 * would leave refresh tokens readable by anything that can read the file, so that
 * backend counts as unavailable and the caller is told to sign in again.
 */
function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform !== 'linux') return true
  return safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

let singleton: ChatgptAuth | null = null
export function chatgptAuth(): ChatgptAuth {
  singleton ??= new ChatgptAuth({
    directory: app.getPath('userData'),
    openBrowser: (url) => shell.openExternal(url),
    encrypt: (text) => (secureStorageAvailable() ? safeStorage.encryptString(text) : null),
    decrypt: (data) => (secureStorageAvailable() ? safeStorage.decryptString(data) : null)
  })
  return singleton
}
export function cancelChatgptLogin(): void {
  singleton?.cancelLogin()
}

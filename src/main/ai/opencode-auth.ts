import { app, safeStorage, shell } from 'electron'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { OpenCodeAuthView } from '../../shared/ai/opencode'
import { asRecord, asString, asNumber, abortError } from './providers/http'

export const OPENCODE_ORIGIN = 'https://opencode.ai'
export const OPENCODE_CONSOLE = `${OPENCODE_ORIGIN}/console`
export const OPENCODE_API_BASE = `${OPENCODE_ORIGIN}/inference/openai/v1`
const CLIENT_ID = 'writemd'
const SIGN_IN = 'Sign in to OpenCode in AI Settings.'

interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  workspaceId: string
  connectionId: string
  refreshAttempted: boolean
}

interface AuthOptions {
  directory: string
  openBrowser: (url: string) => Promise<unknown>
  encrypt: (text: string) => Buffer | null
  decrypt: (data: Buffer) => string | null
  fetcher?: typeof fetch
  now?: () => number
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const cancel = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

/** Device codes and tokens stay in main. Refresh tokens are single use. */
export class OpenCodeAuth {
  private tokens: Tokens | null = null
  private loginController: AbortController | null = null
  private refreshController: AbortController | null = null
  private refreshing: Promise<string> | null = null
  private pending: { userCode: string; verificationUri: string } | null = null
  private error: string | null = null
  private sessionOnly = false
  private listeners = new Set<(state: OpenCodeAuthView) => void>()
  private readonly file: string
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly pause: typeof wait

  constructor(private readonly options: AuthOptions) {
    this.file = join(options.directory, 'opencode-auth.enc')
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.pause = options.wait ?? wait
    try {
      const decrypted = options.decrypt(readFileSync(this.file))
      const value = decrypted ? asRecord(JSON.parse(decrypted) as unknown) : null
      const saved = asRecord(value?.tokens)
      if (value?.version === 1 && saved && !saved.refreshAttempted) {
        this.tokens = this.parseTokens(
          {
            access_token: saved.accessToken,
            refresh_token: saved.refreshToken,
            org_id: saved.workspaceId,
            expires_in: 1
          },
          asString(saved.connectionId) ?? randomUUID()
        )
        this.tokens.expiresAt = asNumber(saved.expiresAt) ?? 0
      } else if (saved?.refreshAttempted) {
        this.error = 'OpenCode sign-in needs to be renewed. Sign in again in AI Settings.'
      }
    } catch {
      // Missing or undecryptable storage requires a fresh browser sign-in.
    }
  }

  state(): OpenCodeAuthView {
    return {
      connected: !!this.tokens && !this.tokens.refreshAttempted,
      pending: !!this.pending,
      connectionId: this.tokens?.connectionId ?? null,
      workspaceId: this.tokens?.workspaceId ?? null,
      userCode: this.pending?.userCode ?? null,
      verificationUri: this.pending?.verificationUri ?? null,
      error: this.error,
      sessionOnly: this.sessionOnly
    }
  }

  subscribe(listener: (state: OpenCodeAuthView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(): void {
    for (const listener of this.listeners) listener(this.state())
  }

  private save(): void {
    if (!this.tokens) {
      try {
        unlinkSync(this.file)
      } catch {
        /* Already absent. */
      }
      return
    }
    const encrypted = this.options.encrypt(JSON.stringify({ version: 1, tokens: this.tokens }))
    if (!encrypted) {
      this.sessionOnly = true
      // Do not leave an older refresh token behind after a rotation.
      try {
        unlinkSync(this.file)
      } catch {
        /* Already absent. */
      }
      return
    }
    mkdirSync(this.options.directory, { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.file)
      this.sessionOnly = false
    } finally {
      try {
        unlinkSync(temporary)
      } catch {
        /* Renamed. */
      }
    }
  }

  private async post(
    path: string,
    fields: Record<string, string>,
    signal: AbortSignal
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    let response: Response
    let body: Record<string, unknown> | null
    try {
      response = await this.fetcher(`${OPENCODE_CONSOLE}/auth/device/${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }).toString(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      })
      body = asRecord((await response.json()) as unknown)
    } catch {
      if (signal.aborted) throw abortError()
      throw new Error('Could not reach OpenCode sign-in. Try again.')
    }
    if (!body) throw new Error('OpenCode returned an invalid sign-in response.')
    return { status: response.status, body }
  }

  private parseTokens(body: Record<string, unknown>, connectionId: string = randomUUID()): Tokens {
    const accessToken = asString(body.access_token)
    const refreshToken = asString(body.refresh_token)
    const workspaceId = asString(body.org_id)
    const expires = asNumber(body.expires_in)
    if (!accessToken || !refreshToken || !workspaceId || !expires || expires <= 0)
      throw new Error('OpenCode returned incomplete account credentials. Sign in again.')
    return {
      accessToken,
      refreshToken,
      workspaceId,
      expiresAt: this.now() + expires * 1000,
      connectionId,
      refreshAttempted: false
    }
  }

  async login(): Promise<OpenCodeAuthView> {
    this.cancelLogin()
    const controller = new AbortController()
    this.loginController = controller
    this.error = null
    try {
      const result = await this.post('code', { supports_org_scope: 'true' }, controller.signal)
      if (this.loginController !== controller) return this.state()
      if (result.status !== 200)
        throw new Error(`OpenCode sign-in is unavailable (${result.status}). Try again.`)
      const deviceCode = asString(result.body.device_code)
      const userCode = asString(result.body.user_code)
      const uri = asString(result.body.verification_uri_complete)
      const expires = asNumber(result.body.expires_in)
      const interval = asNumber(result.body.interval) ?? 5
      if (!deviceCode || !userCode || !uri || !expires || expires <= 0 || interval < 1)
        throw new Error('OpenCode returned an invalid device code.')
      const url = new URL(uri, OPENCODE_ORIGIN)
      if (
        url.origin !== OPENCODE_ORIGIN ||
        url.pathname !== '/console/device' ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new Error('OpenCode returned an untrusted sign-in address.')
      this.pending = { userCode, verificationUri: url.href }
      this.notify()
      await this.options.openBrowser(url.href)
      if (this.loginController === controller)
        void this.poll(controller, deviceCode, this.now() + expires * 1000, interval * 1000)
    } catch {
      if (this.loginController === controller) {
        this.pending = null
        this.loginController = null
        this.error = 'Could not start OpenCode sign-in. Try again in AI Settings.'
        this.notify()
      }
    }
    return this.state()
  }

  private async poll(
    controller: AbortController,
    deviceCode: string,
    expiresAt: number,
    interval: number
  ): Promise<void> {
    try {
      for (;;) {
        if (this.now() + interval >= expiresAt)
          throw new Error('OpenCode sign-in expired. Start sign-in again.')
        await this.pause(interval, controller.signal)
        if (controller.signal.aborted) throw abortError()
        const result = await this.post(
          'token',
          {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode
          },
          controller.signal
        )
        if (this.loginController !== controller) return
        if (result.status === 200) {
          const tokens = this.parseTokens(result.body)
          this.refreshController?.abort()
          this.tokens = tokens
          this.save()
          this.error = null
          break
        }
        if (result.status === 400 && result.body.error === 'authorization_pending') continue
        if (result.status === 400 && result.body.error === 'slow_down') {
          interval += 5000
          continue
        }
        if (result.body.error === 'access_denied') throw new Error('OpenCode sign-in was declined.')
        if (result.body.error === 'expired_token')
          throw new Error('OpenCode sign-in expired. Start sign-in again.')
        throw new Error(`OpenCode sign-in failed (${result.status}). Start sign-in again.`)
      }
    } catch (error) {
      if (this.loginController === controller && !controller.signal.aborted)
        this.error = error instanceof Error ? error.message : 'OpenCode sign-in failed.'
    } finally {
      if (this.loginController === controller) {
        this.pending = null
        this.loginController = null
        this.notify()
      }
    }
  }

  cancelLogin(): OpenCodeAuthView {
    this.loginController?.abort()
    this.loginController = null
    this.pending = null
    this.notify()
    return this.state()
  }

  logout(): OpenCodeAuthView {
    this.cancelLogin()
    this.refreshController?.abort()
    this.tokens = null
    this.error = null
    this.save()
    this.notify()
    return this.state()
  }

  async accessToken(): Promise<string> {
    if (this.refreshing) return this.refreshing
    const previous = this.tokens
    if (!previous || previous.refreshAttempted) throw new Error(SIGN_IN)
    if (previous.expiresAt > this.now() + 60_000) return previous.accessToken
    const controller = new AbortController()
    this.refreshController = controller
    this.refreshing = Promise.resolve().then(async () => {
      try {
        // Mark the token spent before sending. A crash or lost response must not replay it.
        previous.refreshAttempted = true
        this.save()
        const result = await this.post(
          'token',
          { grant_type: 'refresh_token', refresh_token: previous.refreshToken },
          controller.signal
        )
        if (this.tokens !== previous || controller.signal.aborted) throw abortError()
        if (result.status !== 200) throw new Error('OpenCode session expired.')
        this.tokens = this.parseTokens(
          { ...result.body, org_id: result.body.org_id ?? previous.workspaceId },
          previous.connectionId
        )
        if (this.tokens.workspaceId !== previous.workspaceId) {
          this.tokens = null
          throw new Error('OpenCode workspace changed.')
        }
        this.save()
        this.error = null
        this.notify()
        return this.tokens.accessToken
      } catch {
        if (
          this.tokens === previous ||
          this.tokens?.connectionId === previous.connectionId ||
          (!this.tokens && !controller.signal.aborted)
        ) {
          this.tokens = null
          this.error = 'OpenCode sign-in needs to be renewed. Sign in again in AI Settings.'
          this.save()
          this.notify()
        }
        throw new Error(SIGN_IN)
      } finally {
        if (this.refreshController === controller) this.refreshController = null
        this.refreshing = null
      }
    })
    return this.refreshing
  }
}

let singleton: OpenCodeAuth | null = null
export function openCodeAuth(): OpenCodeAuth {
  const secure = (): boolean =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  return (singleton ??= new OpenCodeAuth({
    directory: app.getPath('userData'),
    openBrowser: (url) => shell.openExternal(url),
    encrypt: (text) => (secure() ? safeStorage.encryptString(text) : null),
    decrypt: (data) => (secure() ? safeStorage.decryptString(data) : null)
  }))
}
export function cancelOpenCodeLogin(): void {
  singleton?.cancelLogin()
}

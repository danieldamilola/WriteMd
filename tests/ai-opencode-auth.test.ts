import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { OpenCodeAuth } from '../src/main/ai/opencode-auth'
import { makeTempRoot, cleanupTempRoot } from './helpers/temp-root'

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }))
const directories: string[] = []
const sessions: OpenCodeAuth[] = []
const token = {
  access_token: 'access-secret',
  refresh_token: 'refresh-secret',
  org_id: 'org_test',
  expires_in: 3600
}
const code = {
  device_code: 'device-secret',
  user_code: 'ABCD-EFGH',
  verification_uri_complete: '/console/device?user_code=ABCD-EFGH',
  expires_in: 600,
  interval: 5
}
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })
const encrypt = (text: string): Buffer => Buffer.from(Buffer.from(text).toString('base64'))
const decrypt = (data: Buffer): string => Buffer.from(data.toString(), 'base64').toString()

function fixture(
  handler?: (url: string, fields: URLSearchParams) => Response | Promise<Response>,
  saved?: Record<string, unknown>
): {
  auth: OpenCodeAuth
  fetcher: Mock<typeof fetch>
  openBrowser: Mock<(url: string) => Promise<void>>
  directory: string
  file: string
  options: ConstructorParameters<typeof OpenCodeAuth>[0]
} {
  const directory = makeTempRoot('opencode-auth')
  directories.push(directory)
  const file = join(directory, 'opencode-auth.enc')
  if (saved) writeFileSync(file, encrypt(JSON.stringify({ version: 1, tokens: saved })))
  const fetcher = vi.fn<typeof fetch>(async (url, init) =>
    handler
      ? handler(String(url), new URLSearchParams(String(init?.body)))
      : json(String(url).endsWith('/code') ? code : token)
  )
  const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  const options = { directory, fetcher, openBrowser, encrypt, decrypt }
  const auth = new OpenCodeAuth(options)
  sessions.push(auth)
  return { auth, fetcher, openBrowser, directory, file, options }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  sessions.splice(0).forEach((auth) => auth.logout())
  directories.splice(0).forEach(cleanupTempRoot)
  vi.useRealTimers()
})

describe('OpenCode browser sign-in', () => {
  it('keeps device and account credentials out of the renderer and persists encrypted tokens', async () => {
    const { auth, fetcher, openBrowser, file, options } = fixture()
    const view = await auth.login()
    expect(view).toMatchObject({ pending: true, userCode: 'ABCD-EFGH', connected: false })
    expect(openBrowser).toHaveBeenCalledWith(
      'https://opencode.ai/console/device?user_code=ABCD-EFGH'
    )
    expect(JSON.stringify(view)).not.toContain('device-secret')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(
      new URLSearchParams(String(fetcher.mock.calls[0][1]?.body)).get('supports_org_scope')
    ).toBe('true')
    await vi.advanceTimersByTimeAsync(5000)
    expect(auth.state()).toMatchObject({ pending: false, connected: true, workspaceId: 'org_test' })
    expect(JSON.stringify(auth.state())).not.toContain('access-secret')
    expect(readFileSync(file, 'utf8')).not.toContain('refresh-secret')
    expect(await auth.accessToken()).toBe('access-secret')
    const restored = new OpenCodeAuth(options)
    sessions.push(restored)
    expect(restored.state().connectionId).toBe(auth.state().connectionId)
    expect(await restored.accessToken()).toBe('access-secret')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('respects pending and slow_down polling intervals', async () => {
    let polls = 0
    const { auth, fetcher } = fixture((url) =>
      url.endsWith('/code')
        ? json(code)
        : ++polls === 1
          ? json({ error: 'authorization_pending' }, 400)
          : polls === 2
            ? json({ error: 'slow_down' }, 400)
            : json(token)
    )
    await auth.login()
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5001)
    expect(polls).toBe(2)
    expect(auth.state().pending).toBe(true)
    await vi.advanceTimersByTimeAsync(9999)
    expect(polls).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(auth.state().connected).toBe(true)
  })

  it.each(['access_denied', 'expired_token'])(
    'terminates %s without storing credentials',
    async (error) => {
      const { auth, file } = fixture((url) =>
        url.endsWith('/code') ? json(code) : json({ error }, 400)
      )
      await auth.login()
      await vi.advanceTimersByTimeAsync(5000)
      expect(auth.state()).toMatchObject({ pending: false, connected: false })
      expect(auth.state().error).toBeTruthy()
      expect(existsSync(file)).toBe(false)
    }
  )

  it('expires locally and stops polling', async () => {
    const { auth, fetcher } = fixture((url) =>
      url.endsWith('/code')
        ? json({ ...code, expires_in: 6 })
        : json({ error: 'authorization_pending' }, 400)
    )
    await auth.login()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(auth.state().pending).toBe(false)
    expect(auth.state().error).toContain('expired')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('cancels before polling without claiming a connection', async () => {
    const { auth, fetcher } = fixture()
    await auth.login()
    auth.cancelLogin()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(auth.state()).toMatchObject({ pending: false, connected: false, userCode: null })
  })

  it('ignores a late grant after sign-out', async () => {
    let complete: (response: Response) => void = () => undefined
    const { auth } = fixture((url) =>
      url.endsWith('/code')
        ? json(code)
        : new Promise((resolve) => {
            complete = resolve
          })
    )
    await auth.login()
    await vi.advanceTimersByTimeAsync(5000)
    auth.logout()
    complete(json(token))
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.state().connected).toBe(false)
  })

  it.each([
    'https://evil.test/console/device',
    'https://opencode.ai.evil.test/console/device',
    '/console/unrelated',
    'http://opencode.ai/console/device'
  ])('does not open an untrusted verification URI: %s', async (uri) => {
    const { auth, openBrowser } = fixture(() => json({ ...code, verification_uri_complete: uri }))
    await auth.login()
    expect(openBrowser).not.toHaveBeenCalled()
    expect(auth.state().pending).toBe(false)
  })
})

const saved = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  workspaceId: 'org_test',
  connectionId: 'connection-1',
  expiresAt: 0,
  refreshAttempted: false
}
describe('OpenCode single-use refresh tokens', () => {
  it('shares one refresh across concurrent callers and records it before sending', async () => {
    const item = fixture(() => {
      expect(JSON.parse(decrypt(readFileSync(item.file))).tokens.refreshAttempted).toBe(true)
      return json({ ...token, refresh_token: 'rotated-refresh' })
    }, saved)
    expect(
      await Promise.all([item.auth.accessToken(), item.auth.accessToken(), item.auth.accessToken()])
    ).toEqual(['access-secret', 'access-secret', 'access-secret'])
    expect(item.fetcher).toHaveBeenCalledTimes(1)
    expect(
      new URLSearchParams(String(item.fetcher.mock.calls[0][1]?.body)).get('refresh_token')
    ).toBe('old-refresh')
    expect(JSON.parse(decrypt(readFileSync(item.file))).tokens).toMatchObject({
      refreshToken: 'rotated-refresh',
      refreshAttempted: false
    })
  })

  it('never replays a refresh after a lost response', async () => {
    const { auth, fetcher, options } = fixture(() => {
      throw new Error('Connection lost')
    }, saved)
    await expect(auth.accessToken()).rejects.toThrow('Sign in')
    await expect(auth.accessToken()).rejects.toThrow('Sign in')
    const restored = new OpenCodeAuth(options)
    sessions.push(restored)
    await expect(restored.accessToken()).rejects.toThrow('Sign in')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('requires sign-in after a crash during refresh', async () => {
    const { auth, fetcher } = fixture(undefined, { ...saved, refreshAttempted: true })
    expect(auth.state().connected).toBe(false)
    await expect(auth.accessToken()).rejects.toThrow('Sign in')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not restore credentials after sign-out while refreshing', async () => {
    let complete: (response: Response) => void = () => undefined
    const { auth } = fixture(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
      saved
    )
    const refreshing = auth.accessToken()
    const rejected = expect(refreshing).rejects.toThrow('Sign in')
    await vi.advanceTimersByTimeAsync(0)
    auth.logout()
    complete(json(token))
    await rejected
    expect(auth.state().connected).toBe(false)
  })

  it('rejects a refresh that changes workspace', async () => {
    const { auth } = fixture(() => json({ ...token, org_id: 'org_other' }), saved)
    await expect(auth.accessToken()).rejects.toThrow('Sign in')
    expect(auth.state().connected).toBe(false)
  })

  it('supports session-only sign-in without a secure credential store', async () => {
    const { options, file } = fixture()
    const auth = new OpenCodeAuth({ ...options, encrypt: () => null })
    sessions.push(auth)
    await auth.login()
    await vi.advanceTimersByTimeAsync(5000)
    expect(auth.state()).toMatchObject({ connected: true, sessionOnly: true })
    expect(existsSync(file)).toBe(false)
  })
})

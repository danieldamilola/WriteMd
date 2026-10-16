import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ChatgptAuth } from '../src/main/ai/chatgpt-auth'
import { cleanupTempRoot, makeTempRoot } from './helpers/temp-root'

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }))

const ORIGIN = 'https://auth.openai.com'
const DISCOVERY = `${ORIGIN}/.well-known/openid-configuration`
const TOKEN = `${ORIGIN}/api/accounts/oauth/token`
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const directories: string[] = []
const sessions: ChatgptAuth[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function fixture(
  fetcher: typeof fetch,
  savedAccount = false
): {
  auth: ChatgptAuth
  directory: string
  openBrowser: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>
} {
  const directory = makeTempRoot('chatgpt-auth')
  directories.push(directory)
  if (savedAccount) {
    writeFileSync(
      join(directory, 'chatgpt-auth'),
      JSON.stringify({
        version: 1,
        activeId: 'oaiapp_test',
        accounts: [
          {
            clientId: 'oaiapp_test',
            subject: 'test-subject',
            email: 'test@example.test',
            welcomed: true,
            tokens: {
              accessToken: 'old-access',
              refreshToken: 'old-refresh',
              idToken: 'retained-id',
              scopes: SCOPES.split(' '),
              expiresAt: 0,
              earliestRefreshAt: 0
            }
          }
        ]
      })
    )
  }
  const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  const auth = new ChatgptAuth({
    directory,
    openBrowser,
    encrypt: (text) => Buffer.from(text),
    decrypt: (data) => data.toString(),
    fetcher
  })
  sessions.push(auth)
  return { auth, directory, openBrowser }
}

afterEach(() => {
  for (const auth of sessions.splice(0)) auth.cancelLogin()
  for (const directory of directories.splice(0)) cleanupTempRoot(directory)
})

describe('ChatGPT discovery gateway recovery', () => {
  it.each([true, false])(
    'verifies the signed callback identity after fallback (valid nonce: %s)',
    async (validNonce) => {
      const { privateKey, publicKey } = await generateKeyPair('RS256')
      const key = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
      let idToken = ''
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        if (String(input) === DISCOVERY) return json({}, 502)
        if (String(input) === `${ORIGIN}/.well-known/jwks.json`) return json({ keys: [key] })
        if (String(input) === TOKEN)
          return json({
            access_token: 'callback-access',
            refresh_token: 'callback-refresh',
            id_token: idToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: SCOPES
          })
        throw new Error('Unexpected request')
      })
      const { auth, openBrowser } = fixture(fetcher)
      await auth.login()
      const authorization = new URL(openBrowser.mock.calls[0][0])
      idToken = await new SignJWT({
        nonce: validNonce ? authorization.searchParams.get('nonce') : 'wrong-nonce',
        email: 'test@example.test'
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(ORIGIN)
        .setAudience('oaiapp_test')
        .setSubject('test-subject')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      const callback = new URL(authorization.searchParams.get('redirect_uri')!)
      callback.search = new URLSearchParams({
        state: authorization.searchParams.get('state')!,
        client_id: 'oaiapp_test',
        code: 'test-code'
      }).toString()
      const response = await fetch(callback)
      await response.text()
      expect(response.status).toBe(validNonce ? 200 : 400)
      expect(auth.state().connected).toBe(validNonce)
      expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/jwks.json'))).toBe(true)
      if (validNonce) await expect(auth.accessToken()).resolves.toBe('callback-access')
      else expect(auth.state().error).toContain('identity verification failed')
    }
  )

  it.skipIf(process.env.WRITEMD_LIVE_AUTH_TEST !== '1')(
    'prepares authorization against live OpenAI discovery without opening a browser',
    async () => {
      const { auth, openBrowser } = fixture(fetch)
      await auth.login()
      const url = new URL(openBrowser.mock.calls[0][0])
      expect(url.origin).toBe(ORIGIN)
      expect(url.pathname).toBe('/api/accounts/authorize')
      expect(auth.state().pending).toBe(true)
      expect(auth.state().connected).toBe(false)
    },
    30000
  )

  it.each([502, 503, 504])('renews a saved account after discovery HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input) === DISCOVERY) return json({ error: { code: status } }, status)
      if (String(input) === TOKEN)
        return json({
          access_token: 'renewed-access',
          refresh_token: 'rotated-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: SCOPES
        })
      throw new Error('Unexpected request')
    })
    const { auth, directory } = fixture(fetcher, true)

    await expect(auth.accessToken()).resolves.toBe('renewed-access')
    const request = fetcher.mock.calls.find(([url]) => String(url) === TOKEN)?.[1]
    expect(request?.method).toBe('POST')
    expect(request?.redirect).toBe('error')
    const body = new URLSearchParams(String(request?.body))
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('client_id')).toBe('oaiapp_test')
    expect(body.get('refresh_token')).toBe('old-refresh')
    expect(body.get('resource')).toBe('https://api.openai.com/v1')
    expect(readFileSync(join(directory, 'chatgpt-auth'), 'utf8')).toContain('rotated-refresh')
    expect(auth.state().connected).toBe(true)
  })

  it('starts PKCE authorization on the published endpoint after a discovery gateway error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 502))
    const { auth, openBrowser } = fixture(fetcher)
    await auth.login()
    const url = new URL(openBrowser.mock.calls[0][0])
    expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}/api/accounts/authorize`)
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(url.searchParams.get('nonce')).toBeTruthy()
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('scope')).toBe(SCOPES)
    expect(auth.state().connected).toBe(false)
  })

  it('tries discovery again after falling back', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(
        json({
          issuer: ORIGIN,
          authorization_endpoint: `${ORIGIN}/updated-authorize`,
          token_endpoint: TOKEN,
          jwks_uri: `${ORIGIN}/.well-known/jwks.json`
        })
      )
    const { auth, openBrowser } = fixture(fetcher)
    await auth.login()
    auth.cancelLogin()
    await auth.login()
    expect(new URL(openBrowser.mock.calls[1][0]).pathname).toBe('/updated-authorize')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 403, 404, 429])('does not fall back on discovery HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, status))
    const { auth, openBrowser } = fixture(fetcher)
    await expect(auth.login()).rejects.toThrow(`(${status})`)
    expect(openBrowser).not.toHaveBeenCalled()
    expect(auth.state().pending).toBe(false)
  })

  it.each([
    { issuer: 'https://unexpected.example' },
    {
      issuer: ORIGIN,
      authorization_endpoint: 'https://unexpected.example/authorize',
      token_endpoint: TOKEN,
      jwks_uri: `${ORIGIN}/.well-known/jwks.json`
    }
  ])('rejects untrusted discovery without fallback', async (metadata) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(metadata))
    const { auth, openBrowser } = fixture(fetcher)
    await expect(auth.login()).rejects.toThrow('unexpected')
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('preserves the saved credentials when token renewal also returns 502', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({}, 502))
    const { auth, directory } = fixture(fetcher, true)
    const saved = readFileSync(join(directory, 'chatgpt-auth'), 'utf8')
    await expect(auth.accessToken()).rejects.toThrow('(502)')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(readFileSync(join(directory, 'chatgpt-auth'), 'utf8')).toBe(saved)
  })

  it('clears unusable refresh credentials returned as a structured OAuth error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input) === DISCOVERY
          ? json({}, 502)
          : json({ error: { code: 'invalid_grant' } }, 400)
      )
    const { auth } = fixture(fetcher, true)
    await expect(auth.accessToken()).rejects.toThrow('invalid_grant')
    expect(auth.state().connected).toBe(false)
    expect(auth.state().error).toContain('sign-in expired')
  })
})

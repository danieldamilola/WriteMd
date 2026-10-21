import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cli = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('child_process', () => ({
  execFile: cli.execFile,
  default: { execFile: cli.execFile }
}))
vi.mock('electron-log', () => ({ default: { warn: vi.fn() } }))

import { githubStatus, resetGithubCache, starRepository } from '../src/main/github'

type Callback = (error: Error | null, stdout: string) => void

function cliToken(token: string | null): void {
  cli.execFile.mockImplementation(
    (_file: string, _args: string[], _options: unknown, callback: Callback) => {
      if (token) callback(null, `${token}\n`)
      else callback(new Error('gh: not logged in'), '')
    }
  )
}

function json(status: number, body: unknown = null): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  } as unknown as Response
}

const USER = 'https://api.github.com/user'
const STAR = 'https://api.github.com/user/starred/danieldamilola/WriteMd'

let fetchMock: ReturnType<typeof vi.fn>

function respond(routes: Record<string, () => Response>): void {
  fetchMock.mockImplementation((url: string) => {
    const handler = routes[url]
    if (!handler) throw new Error(`unexpected request: ${url}`)
    return Promise.resolve(handler())
  })
}

beforeEach(() => {
  resetGithubCache()
  cli.execFile.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('in-app starring', () => {
  it('falls back to the browser route when the CLI is signed out', async () => {
    cliToken(null)
    await expect(githubStatus()).resolves.toEqual({
      connected: false,
      login: null,
      starred: null,
      reason: 'no-cli'
    })
    await expect(starRepository()).resolves.toMatchObject({ ok: false, reason: 'no-cli' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the CLI account and whether it already starred the repo', async () => {
    cliToken('gho_testtoken123')
    respond({ [USER]: () => json(200, { login: 'danieldamilola' }), [STAR]: () => json(204) })

    await expect(githubStatus()).resolves.toEqual({
      connected: true,
      login: 'danieldamilola',
      starred: true
    })
  })

  it('stars through the API without opening a browser', async () => {
    cliToken('gho_testtoken123')
    respond({ [STAR]: () => json(204) })

    await expect(starRepository()).resolves.toEqual({ ok: true, starred: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(STAR)
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer gho_testtoken123'
    )
  })

  it('asks again with a fresh login when GitHub rejects the token', async () => {
    cliToken('gho_revoked123')
    respond({ [USER]: () => json(401), [STAR]: () => json(401) })

    await expect(githubStatus()).resolves.toMatchObject({ connected: false, reason: 'rejected' })

    cliToken('gho_fresh123')
    respond({ [USER]: () => json(200, { login: 'danieldamilola' }), [STAR]: () => json(404) })
    await expect(githubStatus()).resolves.toMatchObject({ connected: true, starred: false })
  })

  it('does not claim a star when GitHub cannot be reached', async () => {
    cliToken('gho_testtoken123')
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))

    await expect(githubStatus()).resolves.toMatchObject({ connected: true, reason: 'offline' })
    await expect(starRepository()).resolves.toMatchObject({ ok: false, reason: 'offline' })
  })
})

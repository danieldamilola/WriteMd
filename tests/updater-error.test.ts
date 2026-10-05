import { describe, it, expect } from 'vitest'
import { humanizeUpdaterError } from '../src/main/updater-error'

// The message the screenshot showed, trimmed to the parts that matter. The real
// HttpError also carries a stack, which the first-line fallback has to survive.
const notFound =
  'Cannot find latest.yml in the latest release artifacts ' +
  '(https://github.com/danieldamilola/WriteMd/releases/download/v1.3.0/latest.yml): ' +
  'HttpError: 404\n' +
  "'method': 'GET',\n" +
  "'url': 'https://github.com/danieldamilola/WriteMd/releases/download/v1.3.0/latest.yml',\n" +
  "'headers': {'cache-control': 'no-cache', 'content-type': 'text/plain; charset=utf-8', " +
  "'x-frame-options': 'deny', 'x-github-request-id': 'BD89:23FDC4B:F3EA3:907629:6AC36305'}\n" +
  '    at createHttpError (node:events:514:28)'

describe('humanizeUpdaterError', () => {
  it('names the missing release metadata instead of printing the 404 dump', () => {
    const message = humanizeUpdaterError(new Error(notFound))
    expect(message).toBe(
      'The published release is missing its update metadata, so no update can be offered.'
    )
  })

  it('drops headers and stack from the message it returns', () => {
    const message = humanizeUpdaterError(new Error(notFound))
    expect(message).not.toContain('headers')
    expect(message).not.toContain('x-github-request-id')
    expect(message).not.toContain('createHttpError')
    expect(message).not.toContain('\n')
  })

  it('handles a bare string as well as an Error', () => {
    expect(humanizeUpdaterError('Cannot find latest.yml: HttpError: 404')).toContain(
      'update metadata'
    )
  })

  it('reports a missing mac or linux manifest the same way', () => {
    expect(humanizeUpdaterError('Cannot find latest-mac.yml: HttpError: 404')).toContain(
      'update metadata'
    )
    expect(humanizeUpdaterError('Cannot find latest-linux.yml: HttpError: 404')).toContain(
      'update metadata'
    )
  })

  it('distinguishes an unreachable server from a missing manifest', () => {
    expect(humanizeUpdaterError(new Error('getaddrinfo ENOTFOUND github.com'))).toContain(
      'internet connection'
    )
    expect(humanizeUpdaterError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toContain(
      'internet connection'
    )
  })

  it('reports a timeout as a timeout', () => {
    expect(humanizeUpdaterError(new Error('ETIMEDOUT github.com:443'))).toContain('timed out')
  })

  it('reports a certificate failure', () => {
    expect(humanizeUpdaterError(new Error('unable to verify the first certificate'))).toContain(
      'certificate'
    )
  })

  it('reports rate limiting as retryable', () => {
    expect(humanizeUpdaterError(new Error('HttpError: 403 API rate limit exceeded'))).toContain(
      'rate-limiting'
    )
  })

  it('reports a checksum mismatch on download', () => {
    expect(humanizeUpdaterError(new Error('sha512 checksum mismatch, file is corrupt'))).toContain(
      'checksum'
    )
  })

  it('falls back to the first line for anything it does not recognise', () => {
    expect(humanizeUpdaterError(new Error('Something odd happened\nsecond line\nthird'))).toBe(
      'Something odd happened'
    )
  })

  it('truncates a very long first line', () => {
    const message = humanizeUpdaterError(new Error('x'.repeat(400)))
    expect(message.length).toBe(160)
    expect(message.endsWith('...')).toBe(true)
  })

  it('never returns an empty string', () => {
    expect(humanizeUpdaterError(new Error(''))).toBe('Update check failed.')
    expect(humanizeUpdaterError(null)).toBe('Update check failed.')
    expect(humanizeUpdaterError(undefined)).toBe('Update check failed.')
  })
})

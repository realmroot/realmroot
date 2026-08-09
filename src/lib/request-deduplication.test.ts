import { afterEach, describe, expect, it, vi } from 'vitest'
import { deduplicateRequest, resetRequestDeduplicationForTests } from './request-deduplication'

afterEach(resetRequestDeduplicationForTests)

describe('deduplicateRequest', () => {
  it('shares a request started in the same task for one key', () => {
    const request = vi.fn(() => Promise.resolve('result'))

    const first = deduplicateRequest('config', request)
    const second = deduplicateRequest('config', request)

    expect(second).toBe(first)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('shares a slow request until it settles and starts a new request afterward', async () => {
    let resolveRequest: (value: string) => void = () => undefined
    const request = vi.fn(() => new Promise<string>((resolve) => (resolveRequest = resolve)))

    const first = deduplicateRequest('profile', request)
    await Promise.resolve()
    expect(deduplicateRequest('profile', request)).toBe(first)
    expect(request).toHaveBeenCalledTimes(1)

    resolveRequest('result')
    await first
    const next = deduplicateRequest('profile', request)
    expect(request).toHaveBeenCalledTimes(2)
    resolveRequest('next result')
    await next
  })

  it('does not combine different keys', () => {
    const request = vi.fn(() => new Promise<string>(() => undefined))

    deduplicateRequest('different-profile', request)
    deduplicateRequest('different-security', request)
    expect(request).toHaveBeenCalledTimes(2)
  })
})

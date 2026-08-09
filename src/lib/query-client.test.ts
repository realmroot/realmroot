import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '@/lib/api'
import { queryClient, queryClientDefaultOptions } from './query-client'

const retry = queryClientDefaultOptions.queries.retry

describe('query client defaults', () => {
  it('shares the production defaults with the application query client', () => {
    expect(queryClient.getDefaultOptions()).toEqual(queryClientDefaultOptions)
    expect(queryClientDefaultOptions.queries.staleTime).toBe(60_000)
  })

  it('retries one transient network failure only', () => {
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(retry(0, new TypeError('Network request failed'))).toBe(true)
    expect(retry(0, new TypeError('Load failed'))).toBe(true)
    expect(retry(1, new TypeError('Failed to fetch'))).toBe(false)
    expect(retry(0, new TypeError('Invalid value'))).toBe(false)
  })

  it('retries transient HTTP failures but not deterministic failures', () => {
    expect(retry(0, new ApiRequestError('Timeout', 408))).toBe(true)
    expect(retry(0, new ApiRequestError('Rate limited', 429))).toBe(true)
    expect(retry(0, new ApiRequestError('Unavailable', 503))).toBe(true)
    expect(retry(0, new ApiRequestError('Unauthorized', 401))).toBe(false)
    expect(retry(0, new Error('Unexpected'))).toBe(false)
  })
})

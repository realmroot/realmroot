import type { Env } from '@server/env'
import { withRequestErrorBoundary } from '@server/http/request-error-boundary'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { validateEnv, securityPolicy } = vi.hoisted(() => ({ validateEnv: vi.fn(), securityPolicy: vi.fn() }))
vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: (_name: string, run: (span: unknown) => unknown) => run({ setAttribute: vi.fn() }) },
}))
vi.mock('@server/env', () => ({ validateEnv }))
vi.mock('@server/composition', () => ({ createDeps: () => ({ security: { getPolicy: securityPolicy } }) }))
vi.mock('@server/usecases/authorization', () => ({
  reconcileRealmrootResourceServer: vi.fn(),
  synchronizeEnabledResourceScopeRegistries: vi.fn(),
}))

import worker from '@server/worker'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  validateEnv.mockReturnValue({ baseURL: 'https://auth.example.com', securityPolicy: {} })
  securityPolicy.mockRejectedValue(new Error('private database detail'))
})
afterEach(() => vi.restoreAllMocks())

describe('[spec: hosted-auth/request-initialization-failure] final request boundary', () => {
  it.each([
    'environment',
    'database',
  ])('serves independent HTML when %s initialization fails in the real worker entry', async (stage) => {
    if (stage === 'environment')
      validateEnv.mockImplementation(() => {
        throw new Error('private environment detail')
      })
    const response = await worker.fetch(
      new Request('https://auth.example.com/api/auth/oauth2/authorize', { headers: { Accept: 'text/html' } }),
      {} as Env,
      {} as ExecutionContext,
    )
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const html = await response.text()
    expect(html).toContain('Unable to complete this request')
    expect(html).toContain('/auth/sign-in')
    expect(html).toContain(response.headers.get('X-Request-Id'))
    expect(html).not.toContain('private')
    expect(html).not.toContain('<script')
  })

  it.each(['/api/account/profile', '/api/auth/oauth2/token'])('preserves machine error format on %s', async (path) => {
    const response = await worker.fetch(
      new Request(`https://auth.example.com${path}`, { method: 'POST', headers: { Accept: 'application/json' } }),
      {} as Env,
      {} as ExecutionContext,
    )
    expect(response.status).toBe(500)
    const body = await response.json()
    if (path.endsWith('/token'))
      expect(body).toEqual({ error: 'server_error', error_description: 'The service is temporarily unavailable.' })
    else
      expect(body).toMatchObject({ error: { code: 'internal_error', requestId: response.headers.get('X-Request-Id') } })
  })

  it('supports browser callback POSTs and Chinese without loading configuration', async () => {
    const response = await withRequestErrorBoundary(
      new Request('https://auth.example.com/oauth/account-connection/callback', {
        method: 'POST',
        headers: { 'Sec-Fetch-Mode': 'navigate', 'Accept-Language': 'zh-CN' },
      }),
      async () => {
        throw new Error('private')
      },
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('暂时无法完成操作')
  })

  it('does not intercept successful responses or JSON fetches requesting HTML', async () => {
    const original = new Response(null, {
      status: 302,
      headers: { Location: 'https://client.example/callback?error=access_denied' },
    })
    expect(
      await withRequestErrorBoundary(
        new Request('https://auth.example.com/api/auth/oauth2/authorize'),
        async () => original,
      ),
    ).toBe(original)
    const response = await withRequestErrorBoundary(
      new Request('https://auth.example.com/api/account/profile', {
        headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'cors' },
      }),
      async () => {
        throw new Error('private')
      },
    )
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })
})

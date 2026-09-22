import type { Env } from '@server/env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAuth: vi.fn(),
  fetch: vi.fn(),
  policy: vi.fn(),
  createApp: vi.fn(),
}))
vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: (_name: string, run: (span: unknown) => unknown) => run({ setAttribute: vi.fn() }) },
}))
vi.mock('@server/auth', () => ({ createAuth: mocks.createAuth }))
vi.mock('@server/composition', () => ({ createDeps: () => ({ security: { getPolicy: mocks.policy } }) }))
vi.mock('@server/env', () => ({
  validateEnv: () => ({
    baseURL: 'https://auth.example.com',
    authSecret: 'test-secret',
    trustedOrigins: [],
    securityPolicy: {},
  }),
}))
vi.mock('@server/db/client', () => ({ createDb: () => ({}) }))
vi.mock('@server/adapters/gateways/secrets', () => ({ createSecretCipher: vi.fn() }))
vi.mock('@server/adapters/gateways/email/sender', () => ({
  createConfiguredEmailSender: vi.fn(),
  isEmailDeliveryReady: () => false,
}))
vi.mock('@server/adapters/repos/configz', () => ({
  readBuiltInProviderSettings: async () => undefined,
  createDrizzleConfigzRepository: () => ({ getSettings: async () => null, getEmailSettings: async () => null }),
}))
vi.mock('@server/adapters/repos/connectors', () => ({ createConnectorRepository: vi.fn() }))
vi.mock('@server/usecases/connectors', () => ({ loadAuthConnectorConfig: async () => ({ cacheKey: '[]' }) }))
vi.mock('@server/usecases/authorization', () => ({
  reconcileRealmrootResourceServer: async () => {},
  synchronizeEnabledResourceScopeRegistries: vi.fn(),
}))
vi.mock('@server/http/app', () => ({ createApp: mocks.createApp, healthStatus: { ok: true } }))

let worker: typeof import('@server/worker').default
const env = { DB: { prepare: () => ({ all: async () => ({ results: [] }) }) } } as unknown as Env
const request = () => new Request('https://auth.example.com/api/account/profile')
const context = {} as ExecutionContext

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.policy.mockResolvedValue({ mfa: { emailOtpEnabled: false } })
  mocks.createAuth.mockImplementation(() => ({ $context: Promise.resolve({}) }))
  mocks.fetch.mockImplementation(async () => Response.json({ ok: true }))
  mocks.createApp.mockImplementation(() => ({ fetch: mocks.fetch }))
  worker = (await import('@server/worker')).default
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: (value: object) => void
  const promise = new Promise<object>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('[spec: platform-onboarding/auth-initialization-recovery]', () => {
  it('does not cache a failed initializer and the next request recovers', async () => {
    mocks.createAuth.mockImplementationOnce(() => ({ $context: Promise.reject(new Error('D1 failed')) }))
    expect((await worker.fetch(request(), env, context)).status).toBe(500)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect((await worker.fetch(request(), env, context)).status).toBe(200)
    expect(mocks.createAuth).toHaveBeenCalledTimes(2)
  })

  it('bounds pending initialization and does not publish a late result', async () => {
    const late = deferred()
    mocks.createAuth.mockImplementationOnce(() => ({ $context: late.promise }))
    const pending = worker.fetch(request(), env, context)
    await vi.waitFor(() => expect(mocks.createAuth).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await pending).status).toBe(503)
    expect(mocks.fetch).not.toHaveBeenCalled()
    late.resolve({})
    expect((await worker.fetch(request(), env, context)).status).toBe(200)
    expect(mocks.createAuth).toHaveBeenCalledTimes(2)
  })

  it('does not share pending request I/O and reuses only the ready instance', async () => {
    const first = deferred()
    const second = deferred()
    mocks.createAuth
      .mockImplementationOnce(() => ({ $context: first.promise }))
      .mockImplementationOnce(() => ({ $context: second.promise }))
    const a = worker.fetch(request(), env, context)
    const b = worker.fetch(request(), env, context)
    await vi.waitFor(() => expect(mocks.createAuth).toHaveBeenCalledTimes(2))
    expect(mocks.fetch).not.toHaveBeenCalled()
    second.resolve({})
    expect((await b).status).toBe(200)
    expect((await worker.fetch(request(), env, context)).status).toBe(200)
    expect(mocks.createAuth).toHaveBeenCalledTimes(2)
    first.resolve({})
    expect((await a).status).toBe(200)
  })

  it('bounds security policy reads and fails closed until the dependency recovers', async () => {
    const late = deferred()
    mocks.policy.mockReturnValueOnce(late.promise)
    const pending = worker.fetch(request(), env, context)
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await pending).status).toBe(503)
    expect(mocks.createAuth).not.toHaveBeenCalled()
    late.resolve({ stale: true })
    expect((await worker.fetch(request(), env, context)).status).toBe(200)
    expect(mocks.policy).toHaveBeenCalledTimes(2)
  })
})

describe('[spec: platform-onboarding/worker-request-duration]', () => {
  it('includes preparation and route handling in logs and Server-Timing', async () => {
    mocks.policy.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return { mfa: { emailOtpEnabled: false } }
    })
    mocks.fetch.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return Response.json({ ok: true })
    })
    const pending = worker.fetch(request(), env, context)
    await vi.advanceTimersByTimeAsync(200)
    const response = await pending
    expect(response.headers.get('Server-Timing')).toBe('total;dur=150')
    expect(response.headers.get('Request-Id')).toBeTruthy()
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0]![0])).toMatchObject({
      event: 'worker.request.complete',
      durationMs: 150,
      status: 200,
      path: '/api/account/profile',
    })
  })

  it('records initialization timeouts including their failure status', async () => {
    mocks.policy.mockReturnValue(new Promise(() => {}))
    const pending = worker.fetch(request(), env, context)
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await pending).headers.get('Server-Timing')).toBe('total;dur=5000')
    const entries = vi
      .mocked(console.error)
      .mock.calls.filter(([value]) => typeof value === 'string' && value.startsWith('{'))
    expect(JSON.parse(entries[0]![0])).toMatchObject({
      event: 'worker.request.complete',
      durationMs: 5_000,
      status: 503,
    })
  })
})

describe('[spec: platform-onboarding/worker-router-reuse]', () => {
  it('reuses the ready router while passing separate dependencies to each dispatch', async () => {
    await worker.fetch(request(), env, context)
    await worker.fetch(request(), env, context)
    expect(mocks.createApp).toHaveBeenCalledOnce()
    const firstEnv = mocks.fetch.mock.calls[0]![1]
    const secondEnv = mocks.fetch.mock.calls[1]![1]
    expect(firstEnv.realmrootRequestDeps).not.toBe(secondEnv.realmrootRequestDeps)
    const resolveDeps = mocks.createApp.mock.calls[0]![1]
    expect(resolveDeps({ env: firstEnv })).toBe(firstEnv.realmrootRequestDeps)
    expect(resolveDeps({ env: secondEnv })).toBe(secondEnv.realmrootRequestDeps)
    await worker.fetch(request(), { ...env, EMAIL: {} as Env['EMAIL'] }, context)
    expect(mocks.createApp).toHaveBeenCalledTimes(2)
  })
})

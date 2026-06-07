import type { TokenExchangeServiceFactory } from '@server/app'
import { handleApiError } from '@server/lib/errors'
import { createTrustedIssuerRoutes } from '@server/routes/management/trusted-issuers'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

describe('management trusted issuer routes', () => {
  it('lists trusted issuers without exposing configured shared secrets', async () => {
    const service = {
      listTrustedIssuers: vi.fn().mockResolvedValue([
        trustedIssuer({ sharedSecret: 'issuer-secret' }),
        trustedIssuer({
          id: 'tei_2',
          jwksUrl: 'https://ak.example.com/.well-known/jwks.json',
          allowedAudiences: null,
          metadata: null,
        }),
      ]),
    }
    const app = withAdminContext()
    app.route('/trusted-issuers', createTrustedIssuerRoutes(factory(service)))

    const response = await app.request('/trusted-issuers')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      issuers: [
        {
          id: 'tei_1',
          name: 'AK Platform',
          issuer: 'https://ak.example.com',
          jwksUrl: null,
          sharedSecretConfigured: true,
          allowedAudiences: ['https://ama.example.com'],
          enabled: true,
          metadata: { source: 'ak' },
          createdAt: '2026-06-07T00:00:00.000Z',
          updatedAt: '2026-06-07T00:00:00.000Z',
        },
        {
          id: 'tei_2',
          name: 'AK Platform',
          issuer: 'https://ak.example.com',
          jwksUrl: 'https://ak.example.com/.well-known/jwks.json',
          sharedSecretConfigured: false,
          allowedAudiences: [],
          enabled: true,
          metadata: {},
          createdAt: '2026-06-07T00:00:00.000Z',
          updatedAt: '2026-06-07T00:00:00.000Z',
        },
      ],
    })
  })

  it('creates a trusted issuer through the token exchange service', async () => {
    const service = {
      createTrustedIssuer: vi.fn().mockResolvedValue(trustedIssuer({ sharedSecret: 'issuer-secret' })),
    }
    const app = withAdminContext()
    app.route('/trusted-issuers', createTrustedIssuerRoutes(factory(service)))

    const response = await app.request('/trusted-issuers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'AK Platform',
        issuer: 'https://ak.example.com',
        sharedSecret: 'issuer-secret-value',
        allowedAudiences: ['https://ama.example.com'],
        metadata: { source: 'ak' },
      }),
    })

    expect(response.status).toBe(201)
    expect(service.createTrustedIssuer).toHaveBeenCalledWith({
      name: 'AK Platform',
      issuer: 'https://ak.example.com',
      sharedSecret: 'issuer-secret-value',
      allowedAudiences: ['https://ama.example.com'],
      metadata: { source: 'ak' },
    })
    await expect(response.json()).resolves.toMatchObject({
      issuer: {
        id: 'tei_1',
        sharedSecretConfigured: true,
      },
    })
  })

  it('rejects invalid trusted issuer creation payloads', async () => {
    const service = {
      createTrustedIssuer: vi.fn(),
    }
    const app = withAdminContext()
    app.route('/trusted-issuers', createTrustedIssuerRoutes(factory(service)))

    const response = await app.request('/trusted-issuers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'AK Platform',
        issuer: 'not-a-url',
        sharedSecret: 'short',
      }),
    })

    expect(response.status).toBe(400)
    expect(service.createTrustedIssuer).not.toHaveBeenCalled()
  })
})

function withAdminContext() {
  const app = new Hono()
  app.onError((error, c) => handleApiError(error, c))
  app.use('*', async (c, next) => {
    const user = { id: 'admin-1', role: 'admin' }
    c.set('authContext', {
      session: { session: { id: 'session-1' }, user },
      user,
    })
    await next()
  })
  return app
}

function factory(service: Record<string, unknown>): TokenExchangeServiceFactory {
  return () => service as unknown as ReturnType<TokenExchangeServiceFactory>
}

function trustedIssuer(overrides: Partial<TrustedIssuerFixture> = {}) {
  return {
    ...trustedIssuerDefaults(),
    ...overrides,
  }
}

interface TrustedIssuerFixture {
  id: string
  name: string
  issuer: string
  jwksUrl: string | null
  sharedSecret: string | null
  allowedAudiences: string[] | null
  enabled: boolean
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

function trustedIssuerDefaults(): TrustedIssuerFixture {
  const now = new Date('2026-06-07T00:00:00.000Z')
  return {
    id: 'tei_1',
    name: 'AK Platform',
    issuer: 'https://ak.example.com',
    jwksUrl: null,
    sharedSecret: null,
    allowedAudiences: ['https://ama.example.com'],
    enabled: true,
    metadata: { source: 'ak' },
    createdAt: now,
    updatedAt: now,
  }
}

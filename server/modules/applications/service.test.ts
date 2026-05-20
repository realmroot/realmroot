import { describe, expect, it } from 'vitest'
import type { ApplicationResponse } from '../../../shared/api/applications'
import {
  type ApplicationAggregate,
  type ApplicationRepository,
  ApplicationService,
  type ClientSecretRecord,
  type ConsentRecord,
} from './service'

describe('ApplicationService', () => {
  it('creates, lists, updates, inspects, and deletes confidential clients with one-time secrets', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })

    const created = await service.create(
      {
        name: 'Admin Portal',
        clientType: 'confidential_web',
        redirectUris: ['https://app.example.com/callback'],
        allowedGrantTypes: ['authorization_code'],
        allowedScopes: ['openid', 'profile'],
        trusted: true,
      },
      'admin-1',
    )

    expect(created.clientSecret).toMatch(/^fas_/)
    expect(created.secretMetadata).toHaveLength(1)
    expect(created.secretMetadata[0]).not.toHaveProperty('secretHash')
    expect(created).toMatchObject({
      name: 'Admin Portal',
      public: false,
      trusted: true,
      tokenEndpointAuthMethod: 'client_secret_basic',
      requirePkce: false,
      redirectUris: ['https://app.example.com/callback'],
    })

    await expect(service.list({ limit: 50, offset: 0 })).resolves.toMatchObject({
      applications: [{ id: created.id }],
      pagination: {
        limit: 50,
        offset: 0,
        total: 1,
        hasMore: false,
      },
    })

    const updated = await service.update(created.id, {
      name: 'Admin Console',
      redirectUris: ['https://admin.example.com/callback'],
      disabled: true,
      disabledReason: 'security review',
    })
    expect(updated).toMatchObject({
      name: 'Admin Console',
      disabled: true,
      disabledReason: 'security review',
      redirectUris: ['https://admin.example.com/callback'],
    })

    await service.delete(created.id)
    await expect(service.get(created.id)).rejects.toMatchObject({ status: 404 })
  })

  it('does not issue or rotate secrets for public clients', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })

    const created = await service.create(
      {
        name: 'Browser App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )

    expect(created).not.toHaveProperty('clientSecret')
    expect(created).toMatchObject({
      public: true,
      tokenEndpointAuthMethod: 'none',
      requirePkce: true,
    })
    expect(created.secretMetadata).toEqual([])
    await expect(service.rotateSecret(created.id, 'admin-1')).rejects.toMatchObject({
      status: 400,
      message: 'Public clients do not have client secrets.',
    })
  })

  it('rotates confidential client secrets and revokes previous secret metadata', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })
    const created = await service.create(
      {
        name: 'Server App',
        clientType: 'confidential_web',
        redirectUris: ['https://server.example.com/callback'],
      },
      'admin-1',
    )

    const rotated = await service.rotateSecret(created.id, 'admin-2')

    expect(rotated.clientSecret).toMatch(/^fas_/)
    expect(rotated.secret.version).toBe(2)
    const secrets = await service.listSecrets(created.id, { limit: 1, offset: 0 })
    expect(secrets).toMatchObject({
      secrets: [{ version: 2, status: 'active', revokedAt: null }],
      pagination: {
        limit: 1,
        offset: 0,
        total: 2,
        hasMore: true,
      },
    })

    await expect(service.listSecrets(created.id, { limit: 1, offset: 1 })).resolves.toMatchObject({
      secrets: [{ version: 1, status: 'revoked' }],
      pagination: {
        limit: 1,
        offset: 1,
        total: 2,
        hasMore: false,
      },
    })
  })

  it('updates metadata without changing OAuth client settings', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com/' })
    const created = await service.create(
      {
        name: 'Metadata App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )

    await expect(service.update(created.id, { name: 'Renamed App' })).resolves.toMatchObject({
      name: 'Renamed App',
      redirectUris: ['https://spa.example.com/callback'],
      oidc: {
        issuer: 'https://auth.example.com/api/auth',
      },
    })
  })

  it('normalizes partial OAuth client setting updates against existing values', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })
    const created = await service.create(
      {
        name: 'Partial Settings App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
        allowedScopes: ['openid', 'profile'],
      },
      'admin-1',
    )

    await expect(service.update(created.id, { allowedGrantTypes: ['authorization_code'] })).resolves.toMatchObject({
      allowedGrantTypes: ['authorization_code'],
      allowedScopes: ['openid', 'profile', 'offline_access'],
      redirectUris: ['https://spa.example.com/callback'],
    })
    await expect(
      service.replaceRedirectUris(created.id, { redirectUris: ['http://localhost:4173/oidc/callback'] }),
    ).resolves.toMatchObject({
      redirectUris: ['http://localhost:4173/oidc/callback'],
    })
    await expect(
      service.update(created.id, {
        postLogoutRedirectUris: ['https://spa.example.com/signed-out', 'https://spa.example.com/signed-out'],
        corsOrigins: ['https://spa.example.com', 'http://localhost:4173'],
        customData: { plan: 'enterprise' },
      }),
    ).resolves.toMatchObject({
      postLogoutRedirectUris: ['https://spa.example.com/signed-out'],
      corsOrigins: ['https://spa.example.com', 'http://localhost:4173'],
      customData: { plan: 'enterprise' },
    })
  })

  it('paginates application collection responses', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })

    const first = await service.create(
      {
        name: 'First App',
        clientType: 'public_spa',
        redirectUris: ['https://first.example.com/callback'],
      },
      'admin-1',
    )
    const second = await service.create(
      {
        name: 'Second App',
        clientType: 'public_spa',
        redirectUris: ['https://second.example.com/callback'],
      },
      'admin-1',
    )

    await expect(service.list({ limit: 1, offset: 0 })).resolves.toMatchObject({
      applications: [{ id: first.id }],
      pagination: {
        limit: 1,
        offset: 0,
        total: 2,
        hasMore: true,
      },
    })
    await expect(service.list({ limit: 1, offset: 1 })).resolves.toMatchObject({
      applications: [{ id: second.id }],
      pagination: {
        limit: 1,
        offset: 1,
        total: 2,
        hasMore: false,
      },
    })
  })

  it('validates redirect URIs and client grant settings at the API boundary', async () => {
    const service = new ApplicationService(new InMemoryApplicationRepository(), { issuer: 'https://auth.example.com' })

    await expect(
      service.create(
        {
          name: 'Bad SPA',
          clientType: 'public_spa',
          redirectUris: ['https://spa.example.com/callback#token'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Redirect URIs must not include fragments.' })

    await expect(
      service.create(
        {
          name: 'Bad Native App',
          clientType: 'public_native',
          redirectUris: ['com.example.app:/oauth/callback'],
          allowedGrantTypes: ['client_credentials'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Public clients cannot use the client_credentials grant.' })

    await expect(
      service.create(
        {
          name: 'Executable Native Redirect',
          clientType: 'public_native',
          redirectUris: ['javascript:alert(1)'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Native redirect URI schemes are not allowed to be executable or local-resource schemes.',
    })

    await expect(
      service.create(
        {
          name: 'Native App',
          clientType: 'public_native',
          redirectUris: ['com.example.app:/oauth/callback'],
        },
        'admin-1',
      ),
    ).resolves.toMatchObject({
      redirectUris: ['com.example.app:/oauth/callback'],
    })
    await expect(
      service.create(
        {
          name: 'Relative Redirect',
          clientType: 'public_spa',
          redirectUris: ['/callback'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Redirect URIs must be absolute URLs.' })
    await expect(
      service.create(
        {
          name: 'Plain HTTP Redirect',
          clientType: 'public_spa',
          redirectUris: ['http://app.example.com/callback'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Redirect URIs must use HTTPS except localhost development URLs.',
    })
    await expect(
      service.create(
        {
          name: 'Bad Private Scheme',
          clientType: 'public_native',
          redirectUris: ['mobile:/callback'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Native redirect URI schemes must use a reverse-domain private-use scheme.',
    })
    await expect(
      service.create(
        {
          name: 'Unsupported Scope',
          clientType: 'public_spa',
          redirectUris: ['http://localhost:5173/callback'],
          allowedScopes: ['openid', 'bad-scope' as 'openid'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported scope: bad-scope' })
    await expect(
      service.create(
        {
          name: 'Unsupported Grant',
          clientType: 'confidential_web',
          redirectUris: ['https://app.example.com/callback'],
          allowedGrantTypes: ['authorization_code', 'bad-grant' as 'authorization_code'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported grant type: bad-grant' })
  })

  it('validates application post sign-out redirects and CORS origins at the API boundary', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })
    const created = await service.create(
      {
        name: 'Browser App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )

    await expect(
      service.update(created.id, {
        postLogoutRedirectUris: ['https://spa.example.com/signed-out#fragment'],
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Post sign-out redirect URIs must not include fragments.' })
    await expect(
      service.update(created.id, {
        corsOrigins: ['not an origin'],
      }),
    ).rejects.toMatchObject({ status: 400, message: 'CORS origins must be absolute origins.' })
    await expect(
      service.update(created.id, {
        corsOrigins: ['https://spa.example.com/callback'],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'CORS origins must include scheme, host, and optional port only.',
    })
    await expect(
      service.update(created.id, {
        corsOrigins: ['http://spa.example.com'],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'CORS origins must use HTTPS except localhost development origins.',
    })
  })

  it('loads consent data for an authorization request and records consent', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })
    const created = await service.create(
      {
        name: 'Consent App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
        allowedScopes: ['openid', 'profile'],
      },
      'admin-1',
    )

    await service.createConsent({ clientId: created.clientId, scopes: ['openid'] }, 'user-1')
    const consent = await service.loadConsentRequest(
      {
        clientId: created.clientId,
        redirectUri: 'https://spa.example.com/callback',
        scope: 'openid profile',
        state: 'state-1',
        authorizationParams: {
          client_id: created.clientId,
          redirect_uri: 'https://spa.example.com/callback',
          response_type: 'code',
          scope: 'openid profile',
          state: 'state-1',
          code_challenge: 'challenge-1',
          code_challenge_method: 'S256',
          nonce: 'nonce-1',
        },
      },
      { id: 'user-1', email: 'jane@example.com', name: 'Jane Stone', image: 'https://auth.example.com/avatar.png' },
    )

    expect(consent).toMatchObject({
      requestedScopes: ['openid', 'profile'],
      state: 'state-1',
      existingConsent: {
        scopes: ['openid'],
      },
      application: {
        id: created.id,
        clientId: created.clientId,
      },
      user: {
        email: 'jane@example.com',
        displayName: 'Jane Stone',
        image: 'https://auth.example.com/avatar.png',
      },
      redirects: {
        approveUrl: `/api/auth/oauth2/authorize?client_id=${created.clientId}&redirect_uri=https%3A%2F%2Fspa.example.com%2Fcallback&response_type=code&scope=openid+profile&state=state-1&code_challenge=challenge-1&code_challenge_method=S256&nonce=nonce-1`,
        denyUrl:
          'https://spa.example.com/callback?error=access_denied&error_description=The+user+denied+the+authorization+request.&state=state-1',
      },
    })
    expect(consent.application).not.toHaveProperty('secretMetadata')
    await expect(
      service.loadConsentRequest(
        {
          clientId: created.clientId,
          redirectUri: 'https://evil.example.com/callback',
          scope: 'openid',
        },
        { id: 'user-1' },
      ),
    ).rejects.toMatchObject({ status: 400, message: 'redirect_uri is not registered for this client.' })
    await expect(
      service.createConsent({ clientId: created.clientId, scopes: ['bad-scope' as 'openid'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 400, message: 'Scope is not allowed for this client: bad-scope' })
  })

  it('revokes consent for the owning user and rejects missing consent', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })
    const created = await service.create(
      {
        name: 'Consent App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )
    const consent = await service.createConsent({ clientId: created.clientId, scopes: ['openid'] }, 'user-1')

    await expect(service.revokeConsent(consent.id, 'user-1')).resolves.toBeUndefined()
    await expect(service.revokeConsent(consent.id, 'user-1')).rejects.toMatchObject({
      status: 404,
      message: 'Application consent was not found.',
    })
  })

  it('handles OAuth consent defaults and rejects disabled or missing clients', async () => {
    const repository = new InMemoryApplicationRepository()
    const service = new ApplicationService(repository, { issuer: 'https://auth.example.com' })
    const created = await service.create(
      {
        name: 'Consent Defaults App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )

    await expect(
      service.loadConsentRequest(
        {
          clientId: created.clientId,
          redirectUri: 'https://spa.example.com/callback',
        },
        { id: 'user-1' },
      ),
    ).resolves.toMatchObject({
      requestedScopes: ['openid'],
      existingConsent: null,
      state: null,
    })

    await service.update(created.id, { disabled: true })

    await expect(
      service.loadConsentRequest(
        {
          clientId: created.clientId,
          redirectUri: 'https://spa.example.com/callback',
        },
        { id: 'user-1' },
      ),
    ).rejects.toMatchObject({ status: 404, message: 'OAuth client was not found.' })
    await expect(
      service.createConsent({ clientId: created.clientId, scopes: ['openid'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 404, message: 'OAuth client was not found.' })
    await expect(
      service.loadConsentRequest(
        {
          clientId: 'missing-client',
          redirectUri: 'https://spa.example.com/callback',
        },
        { id: 'user-1' },
      ),
    ).rejects.toMatchObject({ status: 404, message: 'OAuth client was not found.' })
  })
})

class InMemoryApplicationRepository implements ApplicationRepository {
  private applications = new Map<string, ApplicationAggregate>()
  private secrets = new Map<string, ClientSecretRecord[]>()
  private consents = new Map<string, ConsentRecord>()

  async create(input: {
    application: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>
    clientSecret: Omit<ClientSecretRecord, 'createdAt' | 'expiresAt' | 'revokedAt'> | null
  }) {
    const now = new Date('2026-05-18T12:00:00.000Z')
    const application = { ...input.application, createdAt: now, updatedAt: now }
    this.applications.set(application.id, application)
    if (input.clientSecret) {
      this.secrets.set(application.id, [{ ...input.clientSecret, createdAt: now, expiresAt: null, revokedAt: null }])
    }
    return application
  }

  async list(pagination: { limit: number; offset: number }) {
    const applications = [...this.applications.values()]
    return {
      items: applications.slice(pagination.offset, pagination.offset + pagination.limit),
      pagination: toPaginationMetadata(pagination, applications.length),
    }
  }

  async findById(id: string) {
    return this.applications.get(id) ?? null
  }

  async findByClientId(clientId: string) {
    return [...this.applications.values()].find((application) => application.clientId === clientId) ?? null
  }

  async update(id: string, patch: Partial<Omit<ApplicationAggregate, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>>) {
    const application = this.applications.get(id)
    if (application) {
      this.applications.set(id, {
        ...application,
        ...withoutUndefined(patch),
        updatedAt: new Date('2026-05-18T13:00:00.000Z'),
      })
    }
  }

  async delete(id: string) {
    this.applications.delete(id)
    this.secrets.delete(id)
  }

  async listSecrets(applicationId: string, pagination: { limit: number; offset: number }) {
    const secrets = [...(this.secrets.get(applicationId) ?? [])].sort((a, b) => b.version - a.version)
    return {
      items: secrets.slice(pagination.offset, pagination.offset + pagination.limit),
      pagination: toPaginationMetadata(pagination, secrets.length),
    }
  }

  async rotateSecret(input: {
    applicationId: string
    secret: Omit<ClientSecretRecord, 'createdAt' | 'expiresAt' | 'revokedAt'>
  }) {
    const now = new Date('2026-05-18T14:00:00.000Z')
    const secrets = this.secrets.get(input.applicationId) ?? []
    const revoked = secrets.map((secret) =>
      secret.status === 'active' ? { ...secret, status: 'revoked', revokedAt: now } : secret,
    )
    const nextSecret = {
      ...input.secret,
      version: Math.max(0, ...secrets.map((secret) => secret.version)) + 1,
      createdAt: now,
      expiresAt: null,
      revokedAt: null,
    }
    this.secrets.set(input.applicationId, [nextSecret, ...revoked])
    return nextSecret
  }

  async findConsent(applicationId: string, userId: string) {
    return this.consents.get(consentKey(applicationId, userId)) ?? null
  }

  async revokeConsent(consentId: string, userId: string) {
    const entry = [...this.consents.entries()].find(
      ([key, consent]) => key.endsWith(`:${userId}`) && consent.id === consentId,
    )
    if (!entry) return false
    this.consents.delete(entry[0])
    return true
  }

  async createConsent(input: {
    applicationId: string
    clientId: string
    userId: string
    scopes: ApplicationResponse['allowedScopes']
    permissions: string[]
  }) {
    const consent = {
      id: `consent-${this.consents.size + 1}`,
      scopes: input.scopes,
      grantedAt: new Date('2026-05-18T15:00:00.000Z'),
    }
    this.consents.set(consentKey(input.applicationId, input.userId), consent)
    return consent
  }
}

function consentKey(applicationId: string, userId: string) {
  return `${applicationId}:${userId}`
}

function withoutUndefined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

function toPaginationMetadata(pagination: { limit: number; offset: number }, total: number) {
  const nextOffset = pagination.offset + pagination.limit < total ? pagination.offset + pagination.limit : null

  return {
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    hasMore: nextOffset !== null,
    nextOffset,
  }
}

import {
  createApplication as createApplicationUsecase,
  createConsent,
  getApplicationAuthorization,
  listApplicationAuthorizations,
  loadConsentRequest,
  putApplicationAuthorizationRevocation,
  revokeConsent,
  updateApplication,
} from '@server/usecases/applications'
import type { Deps } from '@server/usecases/deps'
import { createIdentifierGeneratorFake } from '@server/usecases/identifier-generator.fake'
import type {
  ApplicationAggregate,
  ApplicationRepository,
  ClientSecretRecord,
  ConsentRecord,
} from '@server/usecases/ports'
import { describe, expect, it } from 'vitest'

function createApplication(
  deps: Deps,
  issuer: string,
  input: Omit<Parameters<typeof createApplicationUsecase>[2], 'ownerOrganizationId'> & {
    ownerOrganizationId?: string
  },
  actorUserId: string,
) {
  const ownerOrganizationId = input.ownerOrganizationId ?? 'org_platform'
  return createApplicationUsecase(
    {
      ...deps,
      authorization: {
        ...deps.authorization,
        findOrganization: deps.authorization?.findOrganization ?? (async () => ({ disabled: false })),
      },
    } as Deps,
    issuer,
    { ...input, ownerOrganizationId },
    actorUserId,
  )
}

describe('service.test 3', () => {
  it('keeps consent bound to the authenticated account after account switching [spec: hosted-auth/oauth-consent-account-switch]', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { ids: createIdentifierGeneratorFake(), applications: repository } as unknown as Deps
    const issuer = 'https://auth.example.com'
    const application = await createApplication(
      deps,
      issuer,
      {
        name: 'Account Switch App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )
    const first = await createConsent(
      deps,
      { clientId: application.clientId, resourceServerId: null, scopes: ['openid'] },
      'user-1',
    )

    await expect(
      loadConsentRequest(
        deps,
        issuer,
        { clientId: application.clientId, redirectUri: 'https://spa.example.com/callback' },
        { id: 'user-2' },
      ),
    ).resolves.toMatchObject({ existingConsent: null })
    const second = await createConsent(
      deps,
      { clientId: application.clientId, resourceServerId: null, scopes: ['openid'] },
      'user-2',
    )
    expect(second.id).not.toBe(first.id)
  })

  it('revokes consent for the owning user and rejects missing consent', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { ids: createIdentifierGeneratorFake(), applications: repository } as unknown as Deps
    const issuer = 'https://auth.example.com'
    const created = await createApplication(
      deps,
      issuer,
      {
        name: 'Consent App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )
    const consent = await createConsent(
      deps,
      { clientId: created.clientId, resourceServerId: null, scopes: ['openid'] },
      'user-1',
    )

    await expect(revokeConsent(deps, consent.id, 'user-1')).resolves.toBeUndefined()
    await expect(revokeConsent(deps, consent.id, 'user-1')).rejects.toMatchObject({
      status: 404,
      message: 'Application consent was not found.',
    })
  })

  it('lists and revokes active consent from application management [spec: admin-console/admin-application-detail]', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { ids: createIdentifierGeneratorFake(), applications: repository } as unknown as Deps
    const created = await createApplication(
      deps,
      'https://auth.example.com',
      {
        name: 'Managed Consent App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )
    const consent = await createConsent(
      deps,
      { clientId: created.clientId, resourceServerId: null, scopes: ['openid'] },
      'user-1',
    )

    await expect(
      listApplicationAuthorizations(deps, { applicationId: created.id, limit: 50, offset: 0 }),
    ).resolves.toMatchObject({
      items: [
        {
          id: consent.id,
          user: { id: 'user-1', displayName: 'Test user', email: 'user@example.com' },
          scopes: ['openid'],
        },
      ],
      pagination: { total: 1 },
    })
    const revocation = await putApplicationAuthorizationRevocation(deps, consent.id)
    await expect(putApplicationAuthorizationRevocation(deps, consent.id)).resolves.toEqual(revocation)
    await expect(getApplicationAuthorization(deps, consent.id)).resolves.toMatchObject({
      id: consent.id,
      status: 'revoked',
    })

    repository.failAuthorizationRevocation = true
    const secondConsent = await createConsent(
      deps,
      { clientId: created.clientId, resourceServerId: null, scopes: ['openid'] },
      'user-2',
    )
    await expect(putApplicationAuthorizationRevocation(deps, secondConsent.id)).rejects.toMatchObject({ status: 404 })
  })

  it('projects scoped and expired authorization resources and enforces revocation invariants', async () => {
    const expiredAt = new Date('2020-01-01T00:00:00.000Z')
    const authorization = {
      id: 'authorization-1',
      applicationId: 'app-1',
      userId: 'user-1',
      userDisplayName: 'Test user',
      userEmail: 'user@example.com',
      scopes: ['openid'],
      grantedAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: expiredAt,
      revokedAt: null,
    }
    const applications = {
      listAuthorizations: async () => ({
        items: [authorization],
        pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
      }),
      findAuthorization: async (id: string) => (id === authorization.id ? authorization : null),
      revokeAuthorization: async () => true,
    }
    const deps = { ids: createIdentifierGeneratorFake(), applications } as unknown as Deps

    await expect(listApplicationAuthorizations(deps, { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          status: 'expired',
          expiresAt: expiredAt.toISOString(),
        },
      ],
    })
    await expect(getApplicationAuthorization(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(putApplicationAuthorizationRevocation(deps, authorization.id)).rejects.toThrow('was not revoked')
  })

  it('handles OAuth consent defaults and rejects disabled or missing clients', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { ids: createIdentifierGeneratorFake(), applications: repository } as unknown as Deps
    const issuer = 'https://auth.example.com'
    const created = await createApplication(
      deps,
      issuer,
      {
        name: 'Consent Defaults App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )

    await expect(
      loadConsentRequest(
        deps,
        issuer,
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

    await updateApplication(deps, issuer, created.id, { disabled: true })

    await expect(
      loadConsentRequest(
        deps,
        issuer,
        {
          clientId: created.clientId,
          redirectUri: 'https://spa.example.com/callback',
        },
        { id: 'user-1' },
      ),
    ).rejects.toMatchObject({ status: 404, message: 'OAuth client was not found.' })
    await expect(
      createConsent(deps, { clientId: created.clientId, resourceServerId: null, scopes: ['openid'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 404, message: 'OAuth client was not found.' })
    await expect(
      loadConsentRequest(
        deps,
        issuer,
        {
          clientId: 'missing-client',
          redirectUri: 'https://spa.example.com/callback',
        },
        { id: 'user-1' },
      ),
    ).rejects.toMatchObject({ status: 404, message: 'OAuth client was not found.' })
  })

  it('[spec: hosted-auth/application-login-without-resource-access] allows every authenticated user to authorize the application', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = {
      ids: createIdentifierGeneratorFake(),
      applications: repository,
      authorization: {
        findOrganization: async (id: string) => ({ id, disabled: false }),
      },
    } as unknown as Deps
    const issuer = 'https://auth.example.com'
    const created = await createApplication(
      deps,
      issuer,
      {
        name: 'Limited App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
        ownerOrganizationId: 'org-allowed',
      },
      'admin-1',
    )
    const request = {
      clientId: created.clientId,
      redirectUri: 'https://spa.example.com/callback',
    }

    await expect(loadConsentRequest(deps, issuer, request, { id: 'user-assigned' })).resolves.toBeDefined()
    await expect(loadConsentRequest(deps, issuer, request, { id: 'user-other' })).resolves.toBeDefined()
    await expect(
      createConsent(deps, { clientId: created.clientId, resourceServerId: null, scopes: ['openid'] }, 'user-other'),
    ).resolves.toBeDefined()
    await expect(loadConsentRequest(deps, issuer, request, { id: 'user-member' })).resolves.toBeDefined()
  })
  it('binds consent to an active Resource Server visible to the current user', async () => {
    const repository = new InMemoryApplicationRepository()
    const resource = {
      id: 'resource-1',
      resourceUrl: 'https://api.example.com',
      enabled: true,
      visibility: 'private',
      ownerOrganizationId: 'org-1',
      scopeRegistry: { scopes: [{ value: 'items:read', description: null, grantMode: 'assigned' }] },
    }
    const authorization = {
      findOrganization: async () => ({ disabled: false }),
      findResources: async () => [resource],
      findResource: async () => resource,
      findResourceByResourceUrl: async () => resource,
      findMemberByOrganizationUser: async (_organizationId: string, userId: string) =>
        userId === 'member-1' ? { id: 'membership-1' } : null,
    }
    const deps = { ids: createIdentifierGeneratorFake(), applications: repository, authorization } as unknown as Deps
    const created = await createApplication(
      deps,
      'https://auth.example.com',
      {
        name: 'Resource Consent App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
        ownerOrganizationId: 'org-1',
        resourceScopes: [{ resourceServerId: resource.id, scopes: ['items:read'] }],
      },
      'admin-1',
    )

    await expect(
      loadConsentRequest(
        deps,
        'https://auth.example.com',
        {
          clientId: created.clientId,
          redirectUri: 'https://spa.example.com/callback',
          scope: 'items:read',
          state: 'state-1',
          authorizationParams: { resource: resource.resourceUrl },
        },
        { id: 'member-1', username: 'member', image: 'https://example.com/avatar.png' },
      ),
    ).resolves.toMatchObject({ resourceServerId: resource.id, requestedScopes: ['items:read'], state: 'state-1' })
    await expect(
      createConsent(
        deps,
        {
          clientId: created.clientId,
          resourceServerId: resource.id,
          scopes: ['items:read'],
        },
        'member-1',
      ),
    ).resolves.toMatchObject({ scopes: ['items:read'] })
    await expect(
      createConsent(
        deps,
        {
          clientId: created.clientId,
          resourceServerId: resource.id,
          scopes: ['items:read'],
        },
        'outsider',
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('not visible') })
    await expect(
      loadConsentRequest(
        {
          ...deps,
          authorization: { ...authorization, findResourceByResourceUrl: async () => null },
        } as unknown as Deps,
        'https://auth.example.com',
        {
          clientId: created.clientId,
          redirectUri: 'https://spa.example.com/callback',
          authorizationParams: { resource: resource.resourceUrl },
        },
        { id: 'member-1' },
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('not active') })
  })
})

class InMemoryApplicationRepository implements ApplicationRepository {
  private applications = new Map<string, ApplicationAggregate>()
  private secrets = new Map<string, ClientSecretRecord[]>()
  private consents = new Map<string, ConsentRecord>()
  private authorizationRevocations = new Map<string, Date>()
  failAuthorizationRevocation = false

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

  applicationCount() {
    return this.applications.size
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
    return application ? ('updated' as const) : ('application_not_found' as const)
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

  async listAuthorizations(query: {
    applicationId?: string
    userId?: string
    limit: number
    offset: number
    status?: 'active' | 'expired' | 'revoked'
  }) {
    const authorizations = [...this.consents.entries()]
      .filter(([key]) => !query.applicationId || key.startsWith(`${query.applicationId}:`))
      .filter(([key]) => !query.userId || key.slice(key.indexOf(':') + 1) === query.userId)
      .map(([key, consent]) => ({
        ...consent,
        applicationId: key.slice(0, key.indexOf(':')),
        applicationName: 'Test application',
        applicationSlug: 'test-application',
        userId: key.slice(key.indexOf(':') + 1),
        userDisplayName: 'Test user',
        userEmail: 'user@example.com',
        expiresAt: null,
        revokedAt: this.authorizationRevocations.get(consent.id) ?? null,
      }))
    return {
      items: authorizations.slice(query.offset, query.offset + query.limit),
      pagination: toPaginationMetadata(query, authorizations.length),
    }
  }

  async findAuthorization(authorizationId: string) {
    const entry = [...this.consents.entries()].find(([, consent]) => consent.id === authorizationId)
    if (!entry) return null
    const [key, consent] = entry
    const applicationId = key.slice(0, key.indexOf(':'))
    return {
      ...consent,
      applicationId,
      applicationName: 'Test application',
      applicationSlug: 'test-application',
      userId: key.slice(applicationId.length + 1),
      userDisplayName: 'Test user',
      userEmail: 'user@example.com',
      expiresAt: null,
      revokedAt: this.authorizationRevocations.get(consent.id) ?? null,
    }
  }

  async revokeAuthorization(authorizationId: string) {
    if (this.failAuthorizationRevocation) return false
    const entry = [...this.consents.entries()].find(([, consent]) => consent.id === authorizationId)
    if (!entry) return false
    this.authorizationRevocations.set(authorizationId, new Date('2026-05-18T16:00:00.000Z'))
    return true
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
    resourceServerId: string | null
    scopes: string[]
  }) {
    const consent = {
      id: `consent-${this.consents.size + 1}`,
      resourceServerId: input.resourceServerId,
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

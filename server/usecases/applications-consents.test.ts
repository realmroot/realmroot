import {
  createApplication,
  createConsent,
  listApplicationAuthorizations,
  loadConsentRequest,
  revokeApplicationAuthorization,
  revokeConsent,
  updateApplication,
} from '@server/usecases/applications'
import type { Deps } from '@server/usecases/deps'
import type {
  ApplicationAggregate,
  ApplicationRepository,
  ClientSecretRecord,
  ConsentRecord,
} from '@server/usecases/ports'
import type { ApplicationResponse } from '@shared/api/applications'
import { describe, expect, it } from 'vitest'

describe('service.test 3', () => {
  it('revokes consent for the owning user and rejects missing consent', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { applications: repository } as unknown as Deps
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
    const consent = await createConsent(deps, { clientId: created.clientId, scopes: ['openid'] }, 'user-1')

    await expect(revokeConsent(deps, consent.id, 'user-1')).resolves.toBeUndefined()
    await expect(revokeConsent(deps, consent.id, 'user-1')).rejects.toMatchObject({
      status: 404,
      message: 'Application consent was not found.',
    })
  })

  it('lists and revokes active consent from application management [spec: admin-console/admin-application-detail]', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { applications: repository } as unknown as Deps
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
    const consent = await createConsent(deps, { clientId: created.clientId, scopes: ['openid'] }, 'user-1')

    await expect(listApplicationAuthorizations(deps, created.id, { limit: 50, offset: 0 })).resolves.toMatchObject({
      authorizations: [
        {
          id: consent.id,
          user: { id: 'user-1', displayName: 'Test user', email: 'user@example.com' },
          scopes: ['openid'],
        },
      ],
      pagination: { total: 1 },
    })
    await expect(revokeApplicationAuthorization(deps, created.id, consent.id)).resolves.toBeUndefined()
    await expect(revokeApplicationAuthorization(deps, created.id, consent.id)).rejects.toMatchObject({
      status: 404,
      message: 'Application authorization was not found.',
    })
  })

  it('handles OAuth consent defaults and rejects disabled or missing clients', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { applications: repository } as unknown as Deps
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
      createConsent(deps, { clientId: created.clientId, scopes: ['openid'] }, 'user-1'),
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

  it('[spec: hosted-auth/application-audience-enforcement] gates authorization by assigned user and active Organization membership', async () => {
    const repository = new InMemoryApplicationRepository()
    const members = new Set(['org-allowed:user-member'])
    const deps = {
      applications: repository,
      users: { getUser: async (id: string) => ({ id }) },
      authorization: {
        findOrganization: async (id: string) =>
          id === 'org-allowed' ? { id, disabled: false } : id === 'org-disabled' ? { id, disabled: true } : null,
        findMemberByOrganizationUser: async (organizationId: string, userId: string) =>
          members.has(`${organizationId}:${userId}`) ? { id: `member-${userId}` } : null,
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
      },
      'admin-1',
    )
    const request = {
      clientId: created.clientId,
      redirectUri: 'https://spa.example.com/callback',
    }

    await updateApplication(deps, issuer, created.id, {
      audience: { mode: 'users', organizationIds: [], userIds: ['user-assigned'] },
    })
    await expect(loadConsentRequest(deps, issuer, request, { id: 'user-assigned' })).resolves.toBeDefined()
    await expect(loadConsentRequest(deps, issuer, request, { id: 'user-other' })).rejects.toMatchObject({
      status: 403,
      message: 'This application is not available to the current user.',
    })
    await expect(
      createConsent(deps, { clientId: created.clientId, scopes: ['openid'] }, 'user-other'),
    ).rejects.toMatchObject({
      status: 403,
    })

    await updateApplication(deps, issuer, created.id, {
      audience: { mode: 'organizations', organizationIds: ['org-allowed'], userIds: [] },
    })
    await expect(loadConsentRequest(deps, issuer, request, { id: 'user-member' })).resolves.toBeDefined()
    await expect(loadConsentRequest(deps, issuer, request, { id: 'user-other' })).rejects.toMatchObject({ status: 403 })
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

  async listAuthorizations(applicationId: string, pagination: { limit: number; offset: number }) {
    const authorizations = [...this.consents.entries()]
      .filter(([key]) => key.startsWith(`${applicationId}:`))
      .map(([key, consent]) => ({
        ...consent,
        userId: key.slice(applicationId.length + 1),
        userDisplayName: 'Test user',
        userEmail: 'user@example.com',
        organizationId: null,
        organizationName: null,
        permissions: [],
        expiresAt: null,
      }))
    return {
      items: authorizations.slice(pagination.offset, pagination.offset + pagination.limit),
      pagination: toPaginationMetadata(pagination, authorizations.length),
    }
  }

  async revokeAuthorization(applicationId: string, authorizationId: string) {
    const entry = [...this.consents.entries()].find(
      ([key, consent]) => key.startsWith(`${applicationId}:`) && consent.id === authorizationId,
    )
    if (!entry) return false
    this.consents.delete(entry[0])
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

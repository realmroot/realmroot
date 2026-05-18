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
      },
      'user-1',
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
    })
    expect(consent.application).not.toHaveProperty('secretMetadata')
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
  return {
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    hasMore: pagination.offset + pagination.limit < total,
  }
}

import {
  createApplication,
  createConsent,
  loadConsentRequest,
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

  async upsertSystem(input: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>) {
    const existing = this.applications.get(input.id)
    const now = new Date('2026-05-18T12:30:00.000Z')
    const application = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.applications.set(application.id, application)
    this.secrets.delete(application.id)
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

import {
  createApplication,
  createConsent,
  listApplications,
  loadConsentRequest,
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

describe('service.test 2', () => {
  it('paginates application collection responses', async () => {
    const repository = new InMemoryApplicationRepository()
    const deps = { applications: repository } as unknown as Deps
    const issuer = 'https://auth.example.com'

    const first = await createApplication(
      deps,
      issuer,
      {
        name: 'First App',
        clientType: 'public_spa',
        redirectUris: ['https://first.example.com/callback'],
      },
      'admin-1',
    )
    const second = await createApplication(
      deps,
      issuer,
      {
        name: 'Second App',
        clientType: 'public_spa',
        redirectUris: ['https://second.example.com/callback'],
      },
      'admin-1',
    )

    await expect(listApplications(deps, issuer, { limit: 1, offset: 0 })).resolves.toMatchObject({
      applications: [{ id: first.id }],
      pagination: {
        limit: 1,
        offset: 0,
        total: 2,
        hasMore: true,
      },
    })
    await expect(listApplications(deps, issuer, { limit: 1, offset: 1 })).resolves.toMatchObject({
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
    const deps = { applications: new InMemoryApplicationRepository() } as unknown as Deps
    const issuer = 'https://auth.example.com'

    await expect(
      createApplication(
        deps,
        issuer,
        {
          name: 'Bad SPA',
          clientType: 'public_spa',
          redirectUris: ['https://spa.example.com/callback#token'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Redirect URIs must not include fragments.' })

    await expect(
      createApplication(
        deps,
        issuer,
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
      createApplication(
        deps,
        issuer,
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
      createApplication(
        deps,
        issuer,
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
      createApplication(
        deps,
        issuer,
        {
          name: 'Relative Redirect',
          clientType: 'public_spa',
          redirectUris: ['/callback'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Redirect URIs must be absolute URLs.' })
    await expect(
      createApplication(
        deps,
        issuer,
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
      createApplication(
        deps,
        issuer,
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
      createApplication(
        deps,
        issuer,
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
      createApplication(
        deps,
        issuer,
        {
          name: 'Reserved Management Scope',
          clientType: 'public_spa',
          redirectUris: ['http://localhost:5173/callback'],
          allowedScopes: ['openid', 'management:read' as 'openid'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Management scopes are reserved for the system CLI client.',
    })
    await expect(
      createApplication(
        deps,
        issuer,
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
    const deps = { applications: repository } as unknown as Deps
    const issuer = 'https://auth.example.com'
    const created = await createApplication(
      deps,
      issuer,
      {
        name: 'Browser App',
        clientType: 'public_spa',
        redirectUris: ['https://spa.example.com/callback'],
      },
      'admin-1',
    )

    await expect(
      updateApplication(deps, issuer, created.id, {
        postLogoutRedirectUris: ['https://spa.example.com/signed-out#fragment'],
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Post sign-out redirect URIs must not include fragments.' })
    await expect(
      createApplication(
        deps,
        issuer,
        {
          name: 'Bad SPA',
          clientType: 'public_spa',
          redirectUris: ['https://spa.example.com/callback'],
          postLogoutRedirectUris: ['https://spa.example.com/signed-out#fragment'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Post sign-out redirect URIs must not include fragments.' })
    await expect(
      updateApplication(deps, issuer, created.id, {
        corsOrigins: ['not an origin'],
      }),
    ).rejects.toMatchObject({ status: 400, message: 'CORS origins must be absolute origins.' })
    await expect(
      createApplication(
        deps,
        issuer,
        {
          name: 'Bad SPA',
          clientType: 'public_spa',
          redirectUris: ['https://spa.example.com/callback'],
          corsOrigins: ['not an origin'],
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400, message: 'CORS origins must be absolute origins.' })
    await expect(
      updateApplication(deps, issuer, created.id, {
        corsOrigins: ['https://spa.example.com/callback'],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'CORS origins must include scheme, host, and optional port only.',
    })
    await expect(
      updateApplication(deps, issuer, created.id, {
        corsOrigins: ['http://spa.example.com'],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'CORS origins must use HTTPS except localhost development origins.',
    })
  })

  it('loads consent data for an authorization request and records consent', async () => {
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
        allowedScopes: ['openid', 'profile'],
      },
      'admin-1',
    )

    await createConsent(deps, { clientId: created.clientId, scopes: ['openid'] }, 'user-1')
    const consent = await loadConsentRequest(
      deps,
      issuer,
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
      loadConsentRequest(
        deps,
        issuer,
        {
          clientId: created.clientId,
          redirectUri: 'https://evil.example.com/callback',
          scope: 'openid',
        },
        { id: 'user-1' },
      ),
    ).rejects.toMatchObject({ status: 400, message: 'redirect_uri is not registered for this client.' })
    await expect(
      createConsent(deps, { clientId: created.clientId, scopes: ['bad-scope' as 'openid'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 400, message: 'Scope is not allowed for this client: bad-scope' })
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

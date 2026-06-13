import { badRequest, notFound } from '@server/domain/errors'
import {
  buildDeniedAuthorizationUrl,
  createClientSecret,
  createId,
  defaultPagination,
  hashProviderSecret,
  normalizeClientSettings,
  normalizeCorsOrigins,
  normalizePostLogoutRedirectUris,
  normalizeRequestedScopes,
  slugify,
  toSecretMetadata,
} from '@server/usecases/applications-utils'
import type { ApplicationAggregate, ApplicationRepository, ClientSecretRecord } from '@server/usecases/ports'
import {
  type ApplicationResponse,
  type CreateApplicationRequest,
  type CreateApplicationResponse,
  type CreateConsentRequest,
  defaultApplicationOidcClaims,
  type ListApplicationsResponse,
  type ListClientSecretsResponse,
  type PaginationQuery,
  type ReplaceRedirectUrisRequest,
  type RotateClientSecretResponse,
  systemCliClientId,
  type UpdateApplicationRequest,
} from '@shared/api/applications'

export const systemCliApplication = {
  id: 'app_flareauth_cli',
  slug: 'flareauth-cli',
  name: 'FlareAuth CLI',
  clientId: systemCliClientId,
  redirectUris: ['http://127.0.0.1:8484/callback', 'http://localhost:8484/callback'],
  allowedGrantTypes: ['authorization_code', 'refresh_token'],
  allowedScopes: ['openid', 'profile', 'email', 'offline_access', 'management:read', 'management:write'],
} as const satisfies {
  id: string
  slug: string
  name: string
  clientId: string
  redirectUris: string[]
  allowedGrantTypes: ApplicationResponse['allowedGrantTypes']
  allowedScopes: ApplicationResponse['allowedScopes']
}

export interface ApplicationServiceOptions {
  issuer: string
}

export class ApplicationService {
  constructor(
    private readonly repository: ApplicationRepository,
    private readonly options: ApplicationServiceOptions,
  ) {}

  async create(input: CreateApplicationRequest, actorUserId: string): Promise<CreateApplicationResponse> {
    const settings = normalizeClientSettings(
      input.clientType,
      input.redirectUris,
      input.allowedGrantTypes,
      input.allowedScopes,
    )
    const postLogoutRedirectUris = normalizePostLogoutRedirectUris(input.clientType, input.postLogoutRedirectUris ?? [])
    const corsOrigins = normalizeCorsOrigins(input.corsOrigins ?? [])
    const clientSecret = input.clientType === 'confidential_web' ? createClientSecret() : null
    const secretHash = clientSecret ? await hashProviderSecret(clientSecret) : null
    const secretPrefix = clientSecret ? clientSecret.slice(0, 12) : null

    const application = await this.repository.create({
      application: {
        id: createId('app'),
        slug: input.slug ?? slugify(input.name),
        name: input.name,
        description: input.description ?? null,
        homepageUrl: input.homepageUrl ?? null,
        iconUrl: input.iconUrl ?? null,
        clientId: createId('client'),
        clientType: input.clientType,
        public: input.clientType !== 'confidential_web',
        firstParty: input.firstParty ?? false,
        trusted: input.trusted ?? false,
        systemManaged: false,
        disabled: false,
        disabledReason: null,
        redirectUris: settings.redirectUris,
        postLogoutRedirectUris,
        corsOrigins,
        customData: {},
        allowedGrantTypes: settings.allowedGrantTypes,
        allowedScopes: settings.allowedScopes,
        requirePkce: input.clientType !== 'confidential_web',
        tokenEndpointAuthMethod: input.clientType === 'confidential_web' ? 'client_secret_basic' : 'none',
        oidcClaims: input.oidcClaims ?? defaultApplicationOidcClaims,
      },
      clientSecret: secretHash
        ? {
            id: createId('secret'),
            version: 1,
            secretHash,
            secretPrefix,
            status: 'active',
            createdByUserId: actorUserId,
          }
        : null,
    })

    return {
      ...this.toResponse(application, (await this.repository.listSecrets(application.id, defaultPagination())).items),
      ...(clientSecret ? { clientSecret } : {}),
    }
  }

  async list(pagination: PaginationQuery): Promise<ListApplicationsResponse> {
    const result = await this.repository.list(pagination)
    const applications = await Promise.all(
      result.items.map(async (application) =>
        this.toResponse(application, (await this.repository.listSecrets(application.id, defaultPagination())).items),
      ),
    )
    return {
      applications,
      pagination: result.pagination,
    }
  }

  async ensureSystemClients() {
    await this.ensureCliApplication()
  }

  async ensureCliApplication(): Promise<ApplicationResponse> {
    const settings = normalizeClientSettings(
      'public_native',
      [...systemCliApplication.redirectUris],
      [...systemCliApplication.allowedGrantTypes],
      [...systemCliApplication.allowedScopes],
      { allowManagementScopes: true },
    )
    const application = await this.repository.upsertSystem({
      id: systemCliApplication.id,
      slug: systemCliApplication.slug,
      name: systemCliApplication.name,
      description: 'System-managed public native OAuth client for Restish and CLI Management API access.',
      homepageUrl: null,
      iconUrl: null,
      clientId: systemCliApplication.clientId,
      clientType: 'public_native',
      public: true,
      firstParty: true,
      trusted: false,
      systemManaged: true,
      disabled: false,
      disabledReason: null,
      redirectUris: settings.redirectUris,
      postLogoutRedirectUris: [],
      corsOrigins: [],
      customData: {},
      allowedGrantTypes: settings.allowedGrantTypes,
      allowedScopes: settings.allowedScopes,
      requirePkce: true,
      tokenEndpointAuthMethod: 'none',
      oidcClaims: defaultApplicationOidcClaims,
    })
    return this.toResponse(application, [])
  }

  async get(id: string): Promise<ApplicationResponse> {
    const application = await this.requireApplication(id)
    return this.toResponse(application, (await this.repository.listSecrets(id, defaultPagination())).items)
  }

  async update(id: string, input: UpdateApplicationRequest): Promise<ApplicationResponse> {
    const application = await this.requireApplication(id)
    if (application.systemManaged) {
      throw badRequest('System-managed applications cannot be modified.')
    }
    const settings =
      input.redirectUris || input.allowedGrantTypes || input.allowedScopes
        ? normalizeClientSettings(
            application.clientType,
            input.redirectUris ?? application.redirectUris,
            input.allowedGrantTypes ?? application.allowedGrantTypes,
            input.allowedScopes ?? application.allowedScopes,
          )
        : null
    const postLogoutRedirectUris =
      input.postLogoutRedirectUris !== undefined
        ? normalizePostLogoutRedirectUris(application.clientType, input.postLogoutRedirectUris)
        : undefined
    const corsOrigins = input.corsOrigins !== undefined ? normalizeCorsOrigins(input.corsOrigins) : undefined

    await this.repository.update(id, {
      slug: input.slug,
      name: input.name,
      description: input.description,
      homepageUrl: input.homepageUrl,
      iconUrl: input.iconUrl,
      firstParty: input.firstParty,
      trusted: input.trusted,
      disabled: input.disabled,
      disabledReason: input.disabledReason,
      redirectUris: settings?.redirectUris,
      postLogoutRedirectUris,
      corsOrigins,
      customData: input.customData,
      allowedGrantTypes: settings?.allowedGrantTypes,
      allowedScopes: settings?.allowedScopes,
      oidcClaims: input.oidcClaims,
    })

    return this.get(id)
  }

  async replaceRedirectUris(id: string, input: ReplaceRedirectUrisRequest): Promise<ApplicationResponse> {
    const application = await this.requireApplication(id)
    if (application.systemManaged) {
      throw badRequest('System-managed applications cannot be modified.')
    }
    const settings = normalizeClientSettings(
      application.clientType,
      input.redirectUris,
      application.allowedGrantTypes,
      application.allowedScopes,
    )
    await this.repository.update(id, { redirectUris: settings.redirectUris })
    return this.get(id)
  }

  async delete(id: string): Promise<void> {
    const application = await this.requireApplication(id)
    if (application.systemManaged) {
      throw badRequest('System-managed applications cannot be deleted.')
    }
    await this.repository.delete(id)
  }

  async listSecrets(id: string, pagination: PaginationQuery): Promise<ListClientSecretsResponse> {
    await this.requireApplication(id)
    const result = await this.repository.listSecrets(id, pagination)
    return {
      secrets: result.items.map(toSecretMetadata),
      pagination: result.pagination,
    }
  }

  async rotateSecret(id: string, actorUserId: string): Promise<RotateClientSecretResponse> {
    const application = await this.requireApplication(id)
    if (application.public) {
      throw badRequest('Public clients do not have client secrets.')
    }

    const clientSecret = createClientSecret()
    const secret = await this.repository.rotateSecret({
      applicationId: id,
      secret: {
        id: createId('secret'),
        version: 0,
        secretHash: await hashProviderSecret(clientSecret),
        secretPrefix: clientSecret.slice(0, 12),
        status: 'active',
        createdByUserId: actorUserId,
      },
    })

    return {
      clientSecret,
      secret: toSecretMetadata(secret),
    }
  }

  async loadConsentRequest(
    input: {
      clientId: string
      redirectUri: string
      scope?: string
      state?: string
      authorizationParams?: Record<string, string>
    },
    user: { id: string; email?: string | null; name?: string | null; username?: string | null; image?: string | null },
  ) {
    const application = await this.repository.findByClientId(input.clientId)
    if (!application || application.disabled) {
      throw notFound('OAuth client was not found.')
    }
    if (!application.redirectUris.includes(input.redirectUri)) {
      throw badRequest('redirect_uri is not registered for this client.')
    }

    const requestedScopes = normalizeRequestedScopes(input.scope, application.allowedScopes)
    const existingConsent = await this.repository.findConsent(application.id, user.id)

    const { secretMetadata: _secretMetadata, ...applicationResponse } = this.toResponse(application, [])
    const approveParams = new URLSearchParams(input.authorizationParams)
    approveParams.set('client_id', input.clientId)
    approveParams.set('redirect_uri', input.redirectUri)
    if (input.scope) approveParams.set('scope', input.scope)
    if (input.state) approveParams.set('state', input.state)

    return {
      application: applicationResponse,
      user: {
        email: user.email ?? null,
        displayName: user.name ?? user.username ?? user.email ?? null,
        image: user.image ?? null,
      },
      redirects: {
        approveUrl: `/api/auth/oauth2/authorize?${approveParams.toString()}`,
        denyUrl: buildDeniedAuthorizationUrl(input.redirectUri, input.state),
      },
      requestedScopes,
      existingConsent: existingConsent
        ? {
            id: existingConsent.id,
            scopes: existingConsent.scopes,
            grantedAt: existingConsent.grantedAt.toISOString(),
          }
        : null,
      state: input.state ?? null,
    }
  }

  async createConsent(input: CreateConsentRequest, userId: string) {
    const application = await this.repository.findByClientId(input.clientId)
    if (!application || application.disabled) {
      throw notFound('OAuth client was not found.')
    }
    const requestedScopes = normalizeRequestedScopes(input.scopes.join(' '), application.allowedScopes)
    const consent = await this.repository.createConsent({
      applicationId: application.id,
      clientId: application.clientId,
      userId,
      scopes: requestedScopes,
      permissions: input.permissions ?? [],
    })

    return {
      id: consent.id,
      scopes: consent.scopes,
      grantedAt: consent.grantedAt.toISOString(),
    }
  }

  async revokeConsent(consentId: string, userId: string) {
    if (!(await this.repository.revokeConsent(consentId, userId))) {
      throw notFound('Application consent was not found.')
    }
  }

  private async requireApplication(id: string) {
    const application = await this.repository.findById(id)
    if (!application) {
      throw notFound('Application was not found.')
    }
    return application
  }

  private toResponse(application: ApplicationAggregate, secrets: ClientSecretRecord[]): ApplicationResponse {
    const issuer = this.options.issuer.replace(/\/$/, '')
    return {
      id: application.id,
      slug: application.slug,
      name: application.name,
      description: application.description,
      homepageUrl: application.homepageUrl,
      iconUrl: application.iconUrl,
      clientId: application.clientId,
      clientType: application.clientType,
      public: application.public,
      firstParty: application.firstParty,
      trusted: application.trusted,
      systemManaged: application.systemManaged,
      disabled: application.disabled,
      disabledReason: application.disabledReason,
      redirectUris: application.redirectUris,
      postLogoutRedirectUris: application.postLogoutRedirectUris,
      corsOrigins: application.corsOrigins,
      customData: application.customData,
      allowedGrantTypes: application.allowedGrantTypes,
      allowedScopes: application.allowedScopes,
      requirePkce: application.requirePkce,
      tokenEndpointAuthMethod: application.tokenEndpointAuthMethod,
      secretMetadata: secrets.map(toSecretMetadata),
      oidc: {
        issuer: `${issuer}/api/auth`,
        authorizationEndpoint: `${issuer}/api/auth/oauth2/authorize`,
        deviceAuthorizationEndpoint: `${issuer}/api/auth/device/code`,
        tokenEndpoint: `${issuer}/api/auth/oauth2/token`,
        jwksUri: `${issuer}/api/auth/jwks`,
        userInfoEndpoint: `${issuer}/api/auth/oauth2/userinfo`,
        endSessionEndpoint: `${issuer}/api/auth/oauth2/end-session`,
      },
      oidcClaims: application.oidcClaims,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    }
  }
}

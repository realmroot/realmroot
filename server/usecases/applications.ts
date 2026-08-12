import { badRequest, notFound } from '@server/domain/errors'
import {
  buildDeniedAuthorizationUrl,
  createClientSecret,
  defaultPagination,
  hashProviderSecret,
  normalizeClientSettings,
  normalizeCorsOrigins,
  normalizePostLogoutRedirectUris,
  normalizeRequestedScopes,
  slugify,
  toSecretMetadata,
} from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import type { ApplicationAggregate, ApplicationAuthorizationRecord, ClientSecretRecord } from '@server/usecases/ports'
import {
  type ApplicationResponse,
  type CreateApplicationRequest,
  type CreateApplicationResponse,
  type CreateConsentRequest,
  defaultApplicationOidcClaims,
  deviceCodeGrantType,
  type ListApplicationAuthorizationsQuery,
  type ListApplicationAuthorizationsResponse,
  type ListApplicationsResponse,
  type ListClientSecretsResponse,
  type PaginationQuery,
  type ReplaceRedirectUrisRequest,
  type RotateClientSecretResponse,
  type UpdateApplicationRequest,
} from '@shared/api/applications'

export interface ApplicationServiceOptions {
  issuer: string
}

export async function createApplication(
  deps: Deps,
  issuer: string,
  input: CreateApplicationRequest,
  actorUserId: string | null,
): Promise<CreateApplicationResponse> {
  const settings = normalizeClientSettings(input.clientType, input.redirectUris, input.deviceLoginEnabled ?? false)
  const postLogoutRedirectUris = normalizePostLogoutRedirectUris(input.clientType, input.postLogoutRedirectUris ?? [])
  const corsOrigins = normalizeCorsOrigins(input.corsOrigins ?? [])
  const clientSecret = settings.public ? null : createClientSecret()
  const secretHash = clientSecret ? await hashProviderSecret(clientSecret) : null
  const secretPrefix = clientSecret ? clientSecret.slice(0, 12) : null
  const ownerOrganizationId = input.ownerOrganizationId
  await requireActiveOrganization(deps, ownerOrganizationId)
  const resourceScopes = await validateApplicationResourceScopes(deps, ownerOrganizationId, input.resourceScopes ?? [])

  const application = await deps.applications.create({
    application: {
      id: deps.ids.generate(),
      slug: input.slug ?? slugify(input.name),
      name: input.name,
      description: input.description ?? null,
      homepageUrl: input.homepageUrl ?? null,
      iconUrl: input.iconUrl ?? null,
      clientId: deps.ids.generate(),
      clientType: input.clientType,
      public: settings.public,
      firstParty: input.firstParty ?? false,
      trusted: input.trusted ?? false,
      disabled: false,
      disabledReason: null,
      ownerOrganizationId,
      redirectUris: settings.redirectUris,
      postLogoutRedirectUris,
      corsOrigins,
      customData: {},
      allowedGrantTypes: settings.allowedGrantTypes,
      oidcScopes: settings.oidcScopes,
      resourceScopes,
      requirePkce: settings.requirePkce,
      tokenEndpointAuthMethod: settings.tokenEndpointAuthMethod,
      oidcClaims: input.oidcClaims ?? defaultApplicationOidcClaims,
    },
    clientSecret: secretHash
      ? {
          id: deps.ids.generate(),
          version: 1,
          secretHash,
          secretPrefix,
          status: 'active',
          createdByUserId: actorUserId,
        }
      : null,
  })

  return {
    ...toResponse(
      issuer,
      application,
      (await deps.applications.listSecrets(application.id, defaultPagination())).items,
    ),
    ...(clientSecret ? { clientSecret } : {}),
  }
}

export async function listApplications(
  deps: Deps,
  issuer: string,
  pagination: PaginationQuery,
  ownerOrganizationIds?: string[],
): Promise<ListApplicationsResponse> {
  const result = await deps.applications.list(pagination, ownerOrganizationIds)
  const applications = await Promise.all(
    result.items.map(async (application) =>
      toResponse(issuer, application, (await deps.applications.listSecrets(application.id, defaultPagination())).items),
    ),
  )
  return {
    items: applications,
    pagination: result.pagination,
  }
}

export async function getApplication(deps: Deps, issuer: string, id: string): Promise<ApplicationResponse> {
  const application = await requireApplication(deps, id)
  return toResponse(issuer, application, (await deps.applications.listSecrets(id, defaultPagination())).items)
}

export async function updateApplication(
  deps: Deps,
  issuer: string,
  id: string,
  input: UpdateApplicationRequest,
): Promise<ApplicationResponse> {
  const application = await requireApplication(deps, id)
  const settings =
    input.redirectUris || input.deviceLoginEnabled !== undefined
      ? normalizeClientSettings(
          application.clientType,
          input.redirectUris ?? application.redirectUris,
          input.deviceLoginEnabled ?? application.allowedGrantTypes.includes(deviceCodeGrantType),
        )
      : null
  const postLogoutRedirectUris =
    input.postLogoutRedirectUris !== undefined
      ? normalizePostLogoutRedirectUris(application.clientType, input.postLogoutRedirectUris)
      : undefined
  const corsOrigins = input.corsOrigins !== undefined ? normalizeCorsOrigins(input.corsOrigins) : undefined
  if (input.ownerOrganizationId) await requireActiveOrganization(deps, input.ownerOrganizationId)
  const ownerOrganizationId = input.ownerOrganizationId ?? application.ownerOrganizationId
  const resourceScopes = input.resourceScopes
    ? await validateApplicationResourceScopes(
        deps,
        ownerOrganizationId,
        input.resourceScopes,
        new Set(application.resourceScopes.map((configuration) => configuration.resourceServerId)),
      )
    : undefined

  const updated = await deps.applications.update(id, {
    slug: input.slug,
    name: input.name,
    description: input.description,
    homepageUrl: input.homepageUrl,
    iconUrl: input.iconUrl,
    firstParty: input.firstParty,
    trusted: input.trusted,
    disabled: input.disabled,
    disabledReason: input.disabledReason,
    ownerOrganizationId: input.ownerOrganizationId,
    redirectUris: settings?.redirectUris,
    postLogoutRedirectUris,
    corsOrigins,
    customData: input.customData,
    allowedGrantTypes: settings?.allowedGrantTypes,
    oidcScopes: settings?.oidcScopes,
    resourceScopes,
    oidcClaims: input.oidcClaims,
  })
  if (updated === 'application_not_found') throw notFound('Application was not found.')
  if (updated === 'resource_inactive') throw badRequest('Resource Server is not active.')

  return getApplication(deps, issuer, id)
}

export async function replaceRedirectUris(
  deps: Deps,
  issuer: string,
  id: string,
  input: ReplaceRedirectUrisRequest,
): Promise<ApplicationResponse> {
  const application = await requireApplication(deps, id)
  const settings = normalizeClientSettings(
    application.clientType,
    input.redirectUris,
    application.allowedGrantTypes.includes(deviceCodeGrantType),
  )
  await deps.applications.update(id, { redirectUris: settings.redirectUris })
  return getApplication(deps, issuer, id)
}

export async function deleteApplication(deps: Deps, id: string): Promise<void> {
  await requireApplication(deps, id)
  await deps.applications.delete(id)
}

export async function listApplicationSecrets(
  deps: Deps,
  id: string,
  pagination: PaginationQuery,
): Promise<ListClientSecretsResponse> {
  await requireApplication(deps, id)
  const result = await deps.applications.listSecrets(id, pagination)
  return {
    items: result.items.map(toSecretMetadata),
    pagination: result.pagination,
  }
}

export async function listApplicationAuthorizations(
  deps: Deps,
  query: ListApplicationAuthorizationsQuery,
  ownerOrganizationIds?: string[],
): Promise<ListApplicationAuthorizationsResponse> {
  const result = await deps.applications.listAuthorizations(query, ownerOrganizationIds)
  return {
    items: result.items.map(toApplicationAuthorization),
    pagination: result.pagination,
  }
}

export async function getApplicationAuthorization(deps: Deps, authorizationId: string) {
  const authorization = await deps.applications.findAuthorization(authorizationId)
  if (!authorization) throw notFound('Application authorization was not found.')
  return toApplicationAuthorization(authorization)
}

export async function putApplicationAuthorizationRevocation(deps: Deps, authorizationId: string) {
  const authorization = await getApplicationAuthorization(deps, authorizationId)
  if (authorization.revokedAt) {
    return { applicationAuthorizationId: authorizationId, revokedAt: authorization.revokedAt }
  }
  if (!(await deps.applications.revokeAuthorization(authorizationId))) {
    throw notFound('Application authorization was not found.')
  }
  const revoked = await getApplicationAuthorization(deps, authorizationId)
  if (!revoked.revokedAt) throw new Error(`Application authorization ${authorizationId} was not revoked.`)
  return { applicationAuthorizationId: authorizationId, revokedAt: revoked.revokedAt }
}

function toApplicationAuthorization(authorization: ApplicationAuthorizationRecord) {
  const now = Date.now()
  return {
    id: authorization.id,
    applicationId: authorization.applicationId,
    application: {
      id: authorization.applicationId,
      name: authorization.applicationName,
      slug: authorization.applicationSlug,
    },
    user: {
      id: authorization.userId,
      displayName: authorization.userDisplayName,
      email: authorization.userEmail,
    },
    resourceServerId: authorization.resourceServerId,
    scopes: authorization.scopes,
    grantedAt: authorization.grantedAt.toISOString(),
    expiresAt: authorization.expiresAt?.toISOString() ?? null,
    revokedAt: authorization.revokedAt?.toISOString() ?? null,
    status: authorization.revokedAt
      ? ('revoked' as const)
      : authorization.expiresAt && authorization.expiresAt.getTime() <= now
        ? ('expired' as const)
        : ('active' as const),
  }
}

export async function rotateApplicationSecret(
  deps: Deps,
  id: string,
  actorUserId: string | null,
): Promise<RotateClientSecretResponse> {
  const application = await requireApplication(deps, id)
  if (application.public) {
    throw badRequest('Public clients do not have client secrets.')
  }

  const clientSecret = createClientSecret()
  const secret = await deps.applications.rotateSecret({
    applicationId: id,
    secret: {
      id: deps.ids.generate(),
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

export async function loadConsentRequest(
  deps: Deps,
  issuer: string,
  input: {
    clientId: string
    redirectUri: string
    scope?: string
    state?: string
    authorizationParams?: Record<string, string>
  },
  user: { id: string; email?: string | null; name?: string | null; username?: string | null; image?: string | null },
) {
  const application = await deps.applications.findByClientId(input.clientId)
  if (!application || application.disabled) {
    throw notFound('OAuth client was not found.')
  }
  if (!application.redirectUris.includes(input.redirectUri)) {
    throw badRequest('redirect_uri is not registered for this client.')
  }
  const resource = await resolveRequestedResource(deps, input.authorizationParams?.resource, user.id)
  const allowedScopes = [
    ...application.oidcScopes,
    ...(resource
      ? (application.resourceScopes.find((item) => item.resourceServerId === resource.id)?.scopes ?? [])
      : []),
  ]
  const requestedScopes = normalizeRequestedScopes(input.scope, allowedScopes)
  const existingConsent = await deps.applications.findConsent(application.id, user.id, resource?.id ?? null)

  const { secretMetadata: _secretMetadata, ...applicationResponse } = toResponse(issuer, application, [])
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
    resourceServerId: resource?.id ?? null,
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

export async function createConsent(deps: Deps, input: CreateConsentRequest, userId: string) {
  const application = await deps.applications.findByClientId(input.clientId)
  if (!application || application.disabled) {
    throw notFound('OAuth client was not found.')
  }
  const resource = input.resourceServerId
    ? await requireResourceVisibleToUser(deps, input.resourceServerId, userId)
    : null
  const allowedScopes = [
    ...application.oidcScopes,
    ...(resource
      ? (application.resourceScopes.find((item) => item.resourceServerId === resource.id)?.scopes ?? [])
      : []),
  ]
  const requestedScopes = normalizeRequestedScopes(input.scopes.join(' '), allowedScopes)
  const consent = await deps.applications.createConsent({
    applicationId: application.id,
    clientId: application.clientId,
    userId,
    resourceServerId: resource?.id ?? null,
    scopes: requestedScopes,
  })

  return {
    id: consent.id,
    scopes: consent.scopes,
    grantedAt: consent.grantedAt.toISOString(),
  }
}

export async function revokeConsent(deps: Deps, consentId: string, userId: string) {
  if (!(await deps.applications.revokeConsent(consentId, userId))) {
    throw notFound('Application consent was not found.')
  }
}

async function requireApplication(deps: Deps, id: string) {
  const application = await deps.applications.findById(id)
  if (!application) {
    throw notFound('Application was not found.')
  }
  return application
}

function toResponse(
  issuerOption: string,
  application: ApplicationAggregate,
  secrets: ClientSecretRecord[],
): ApplicationResponse {
  const issuer = issuerOption.replace(/\/$/, '')
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
    disabled: application.disabled,
    disabledReason: application.disabledReason,
    ownerOrganizationId: application.ownerOrganizationId,
    redirectUris: application.redirectUris,
    postLogoutRedirectUris: application.postLogoutRedirectUris,
    corsOrigins: application.corsOrigins,
    customData: application.customData,
    allowedGrantTypes: application.allowedGrantTypes,
    oidcScopes: application.oidcScopes,
    resourceScopes: application.resourceScopes,
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

async function requireActiveOrganization(deps: Deps, organizationId: string) {
  const organization = await deps.authorization.findOrganization(organizationId)
  if (!organization) throw notFound('Owner Organization was not found.')
  if (organization.disabled) throw badRequest('Owner Organization must be active.')
}

async function validateApplicationResourceScopes(
  deps: Deps,
  ownerOrganizationId: string,
  configurations: ApplicationResponse['resourceScopes'],
  existingResourceServerIds = new Set<string>(),
) {
  const activeConfigurations: ApplicationResponse['resourceScopes'] = []
  const seen = new Set<string>()
  for (const configuration of configurations) {
    if (seen.has(configuration.resourceServerId)) {
      throw badRequest('Each Resource Server can appear only once in an Application scope allowlist.')
    }
    seen.add(configuration.resourceServerId)
  }
  if (configurations.length === 0) return activeConfigurations
  const resources = new Map(
    (await deps.authorization.findResources(configurations.map(({ resourceServerId }) => resourceServerId))).map(
      (resource) => [resource.id, resource],
    ),
  )
  for (const configuration of configurations) {
    const resource = resources.get(configuration.resourceServerId)
    if (!resource) {
      if (existingResourceServerIds.has(configuration.resourceServerId)) continue
      throw badRequest('Resource Server is not active.')
    }
    if (!resource.enabled) throw badRequest('Resource Server is not active.')
    if (resource.visibility === 'private' && resource.ownerOrganizationId !== ownerOrganizationId) {
      throw badRequest('Private Resource Server is not visible to the Application owner Organization.')
    }
    const declared = new Set(resource.scopeRegistry?.scopes.map((scope) => scope.value) ?? [])
    if (configuration.scopes.some((scope) => !declared.has(scope))) {
      throw badRequest('Application scope allowlist contains an undeclared Resource Server scope.')
    }
    activeConfigurations.push(configuration)
  }
  return activeConfigurations
}

async function resolveRequestedResource(deps: Deps, resourceUrl: string | undefined, userId: string) {
  if (!resourceUrl) return null
  const resource = await deps.authorization.findResourceByResourceUrl(resourceUrl)
  if (!resource) throw badRequest('Requested Resource Server is not active.')
  return requireResourceVisibleToUser(deps, resource.id, userId)
}

async function requireResourceVisibleToUser(deps: Deps, resourceId: string, userId: string) {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource?.enabled) throw badRequest('Requested Resource Server is not active.')
  if (resource.visibility === 'public') return resource
  const membership = await deps.authorization.findMemberByOrganizationUser(resource.ownerOrganizationId, userId)
  if (!membership) throw badRequest('Requested Resource Server is not visible to the current user.')
  return resource
}

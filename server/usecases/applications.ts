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
import { requirePlatformOrganization } from '@server/usecases/system-resources'
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
  tokenExchangeGrantType,
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
  const settings = normalizeClientSettings(
    input.clientType,
    input.redirectUris,
    input.deviceLoginEnabled ?? false,
    (input.tokenExchangePolicies?.length ?? 0) > 0,
  )
  const postLogoutRedirectUris = normalizePostLogoutRedirectUris(input.clientType, input.postLogoutRedirectUris ?? [])
  const corsOrigins = normalizeCorsOrigins(input.corsOrigins ?? [])
  const clientSecret = settings.public ? null : createClientSecret()
  const secretHash = clientSecret ? await hashProviderSecret(clientSecret) : null
  const secretPrefix = clientSecret ? clientSecret.slice(0, 12) : null
  const ownerOrganizationId = input.ownerOrganizationId
  await requireActiveOrganization(deps, ownerOrganizationId)
  const platformOrganization = await requirePlatformOrganization(deps)
  if (input.consentRequired !== undefined && ownerOrganizationId !== platformOrganization.id) {
    throw badRequest('User consent policy can be configured only for Applications owned by the platform Organization.')
  }
  const resourceScopes = await validateApplicationResourceScopes(deps, ownerOrganizationId, input.resourceScopes ?? [])
  const tokenExchangePolicies = await validateTokenExchangePolicies(
    deps,
    ownerOrganizationId,
    settings.allowedGrantTypes,
    input.tokenExchangePolicies ?? [],
    resourceScopes,
  )

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
      visibility: input.visibility ?? 'private',
      consentRequired: ownerOrganizationId === platformOrganization.id ? (input.consentRequired ?? true) : true,
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
      tokenExchangePolicies,
      requirePkce: settings.requirePkce,
      tokenEndpointAuthMethod: settings.tokenEndpointAuthMethod,
      oidcClaims: defaultApplicationOidcClaims,
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
  const nextTokenExchangePolicies = input.tokenExchangePolicies ?? application.tokenExchangePolicies
  const settings =
    input.redirectUris || input.deviceLoginEnabled !== undefined || input.tokenExchangePolicies !== undefined
      ? normalizeClientSettings(
          application.clientType,
          input.redirectUris ?? application.redirectUris,
          input.deviceLoginEnabled ?? application.allowedGrantTypes.includes(deviceCodeGrantType),
          nextTokenExchangePolicies.length > 0,
        )
      : null
  const postLogoutRedirectUris =
    input.postLogoutRedirectUris !== undefined
      ? normalizePostLogoutRedirectUris(application.clientType, input.postLogoutRedirectUris)
      : undefined
  const corsOrigins = input.corsOrigins !== undefined ? normalizeCorsOrigins(input.corsOrigins) : undefined
  const ownerOrganizationId = application.ownerOrganizationId
  const platformOrganization = await requirePlatformOrganization(deps)
  const platformOwned = ownerOrganizationId === platformOrganization.id
  if (input.consentRequired !== undefined && !platformOwned) {
    throw badRequest('User consent policy can be configured only for Applications owned by the platform Organization.')
  }
  const resourceScopes = input.resourceScopes
    ? await validateApplicationResourceScopes(
        deps,
        ownerOrganizationId,
        input.resourceScopes,
        new Set(application.resourceScopes.map((configuration) => configuration.resourceServerId)),
      )
    : undefined
  const tokenExchangePolicies =
    input.tokenExchangePolicies !== undefined || resourceScopes !== undefined
      ? await validateTokenExchangePolicies(
          deps,
          ownerOrganizationId,
          settings?.allowedGrantTypes ?? application.allowedGrantTypes,
          nextTokenExchangePolicies,
          resourceScopes ?? application.resourceScopes,
        )
      : undefined

  const updated = await deps.applications.update(id, {
    slug: input.slug,
    name: input.name,
    description: input.description,
    homepageUrl: input.homepageUrl,
    iconUrl: input.iconUrl,
    consentRequired: platformOwned ? input.consentRequired : application.consentRequired ? undefined : true,
    disabled: input.disabled,
    disabledReason: input.disabledReason,
    visibility: input.visibility,
    redirectUris: settings?.redirectUris,
    postLogoutRedirectUris,
    corsOrigins,
    customData: input.customData,
    allowedGrantTypes: settings?.allowedGrantTypes,
    oidcScopes: settings?.oidcScopes,
    resourceScopes,
    tokenExchangePolicies,
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
    authorizationSource: authorization.authorizationSource,
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
    authorizationParams?: URLSearchParams | Record<string, string>
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
  const resourceUrls = authorizationParameterValues(input.authorizationParams, 'resource')
  const resources = await Promise.all(
    resourceUrls.map((resourceUrl) => resolveRequestedResource(deps, resourceUrl, user.id)),
  )
  const authorizationContexts = await listOAuthAuthorizationContexts(deps, application, resources, user)
  const targets = resources.length ? resources : [null]
  const allowedScopes = [
    ...application.oidcScopes,
    ...targets.flatMap((resource) =>
      resource ? (application.resourceScopes.find((item) => item.resourceServerId === resource.id)?.scopes ?? []) : [],
    ),
  ]
  const requestedScopes = normalizeRequestedScopes(input.scope, allowedScopes)
  const resourceAuthorizations = await Promise.all(
    targets.map(async (resource) => {
      const targetAllowedScopes = new Set([
        ...application.oidcScopes,
        ...(resource
          ? (application.resourceScopes.find((item) => item.resourceServerId === resource.id)?.scopes ?? [])
          : []),
      ])
      const targetRequestedScopes = requestedScopes.filter((scope) => targetAllowedScopes.has(scope))
      const resourceScopeDescriptions = new Map(
        resource?.scopeRegistry?.scopes.map((scope) => [scope.value, scope.description] as const) ?? [],
      )
      const existingConsent = await deps.applications.findConsent(application.id, user.id, resource?.id ?? null)
      const previouslyApproved = new Set(existingConsent?.scopes ?? [])
      const addedScopes = targetRequestedScopes.filter((scope) => !previouslyApproved.has(scope))
      return {
        resourceServerId: resource?.id ?? null,
        resourceUrl: resource?.resourceUrl ?? null,
        resourceName: resource?.name ?? 'Realmroot account',
        requestedScopes: targetRequestedScopes,
        requestedPermissions: targetRequestedScopes.map((scope) => ({
          value: scope,
          description: oidcScopeDescription(scope) ?? resourceScopeDescriptions.get(scope) ?? null,
        })),
        addedScopes,
        previouslyApprovedScopes: targetRequestedScopes.filter((scope) => previouslyApproved.has(scope)),
        consentReason: !existingConsent ? 'initial' : addedScopes.length > 0 ? 'expanded' : 'reauthorization',
        existingConsent: existingConsent
          ? {
              id: existingConsent.id,
              scopes: existingConsent.scopes,
              grantedAt: existingConsent.grantedAt.toISOString(),
            }
          : null,
      } as const
    }),
  )
  const firstAuthorization = resourceAuthorizations[0]!

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
    resourceServerId: firstAuthorization.resourceServerId,
    requestedScopes,
    requestedPermissions: resourceAuthorizations.flatMap((authorization) => authorization.requestedPermissions),
    addedScopes: [...new Set(resourceAuthorizations.flatMap((authorization) => authorization.addedScopes))],
    previouslyApprovedScopes: [
      ...new Set(resourceAuthorizations.flatMap((authorization) => authorization.previouslyApprovedScopes)),
    ],
    consentReason: resourceAuthorizations.some((authorization) => authorization.consentReason === 'initial')
      ? 'initial'
      : resourceAuthorizations.some((authorization) => authorization.consentReason === 'expanded')
        ? 'expanded'
        : 'reauthorization',
    existingConsent: firstAuthorization.existingConsent,
    resourceAuthorizations,
    authorizationContexts,
    state: input.state ?? null,
  }
}

async function listOAuthAuthorizationContexts(
  deps: Deps,
  application: ApplicationAggregate,
  resources: Array<Awaited<ReturnType<typeof resolveRequestedResource>>>,
  user: { id: string; email?: string | null; name?: string | null; username?: string | null },
) {
  const requiredOrganizationIds = new Set<string>()
  if (application.visibility === 'private') requiredOrganizationIds.add(application.ownerOrganizationId)
  for (const resource of resources) {
    if (resource?.visibility === 'private') requiredOrganizationIds.add(resource.ownerOrganizationId)
  }
  if (requiredOrganizationIds.size > 1) {
    throw badRequest('The requested Application and Resource Servers do not share one authorization Context.')
  }

  const memberships = await deps.authorization.listUserMemberships(user.id)
  const organizations = await Promise.all(
    memberships.map((membership) => deps.authorization.findOrganization(membership.organizationId)),
  )
  const activeOrganizations = organizations.filter(
    (organization): organization is NonNullable<(typeof organizations)[number]> =>
      organization !== null && !organization.disabled,
  )
  const requiredOrganizationId = [...requiredOrganizationIds][0]
  const organizationContexts = activeOrganizations
    .filter((organization) => !requiredOrganizationId || organization.id === requiredOrganizationId)
    .map((organization) => ({
      id: `organization:${organization.id}`,
      type: 'organization' as const,
      displayName: organization.displayName ?? organization.name,
      description: 'Organization Context',
      organizationId: organization.id,
    }))
  const userContext = {
    id: `user:${user.id}`,
    type: 'user' as const,
    displayName: user.name ?? user.username ?? user.email ?? 'Personal account',
    description: user.email ? `User Context · ${user.email}` : 'User Context',
    organizationId: null,
  }
  const contexts = requiredOrganizationId ? organizationContexts : [userContext, ...organizationContexts]
  if (contexts.length === 0) throw badRequest('No active authorization Context is available for this request.')
  return contexts
}

export async function resolveOAuthAuthorizationContexts(
  deps: Deps,
  application: ApplicationAggregate,
  resourceUrls: string[],
  user: { id: string; email?: string | null; name?: string | null; username?: string | null },
) {
  const resources = await Promise.all(
    resourceUrls.map((resourceUrl) => resolveRequestedResource(deps, resourceUrl, user.id)),
  )
  return listOAuthAuthorizationContexts(deps, application, resources, user)
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
  const existingConsent = await deps.applications.findConsent(application.id, userId, resource?.id ?? null)
  const scopes = [...new Set([...(existingConsent?.scopes ?? []), ...requestedScopes])].sort()
  const consent = await deps.applications.createConsent({
    applicationId: application.id,
    clientId: application.clientId,
    userId,
    resourceServerId: resource?.id ?? null,
    scopes,
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
    visibility: application.visibility,
    consentRequired: application.consentRequired,
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
    tokenExchangePolicies: application.tokenExchangePolicies,
    oidcClaims: defaultApplicationOidcClaims,
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

async function validateTokenExchangePolicies(
  deps: Deps,
  ownerOrganizationId: string,
  allowedGrantTypes: ApplicationResponse['allowedGrantTypes'],
  policies: ApplicationResponse['tokenExchangePolicies'],
  resourceScopes: ApplicationResponse['resourceScopes'],
) {
  if (policies.length > 0 && !allowedGrantTypes.includes(tokenExchangeGrantType)) {
    throw badRequest('Only confidential Applications can configure token exchange policies.')
  }
  if (policies.length === 0) return policies
  const resourceIds = [
    ...new Set(
      policies.flatMap((policy) => [
        policy.sourceResourceServerId,
        ...('targetResourceServerId' in policy ? [policy.targetResourceServerId] : []),
      ]),
    ),
  ]
  const targetApplicationIds = [
    ...new Set(policies.flatMap((policy) => ('targetApplicationId' in policy ? [policy.targetApplicationId] : []))),
  ]
  const [resourceRows, targetApplicationRows] = await Promise.all([
    deps.authorization.findResources(resourceIds),
    Promise.all(targetApplicationIds.map((id) => deps.applications.findById(id))),
  ])
  const resources = new Map(resourceRows.map((resource) => [resource.id, resource]))
  const targetApplications = new Map(
    targetApplicationRows.flatMap((application) => (application ? [[application.id, application] as const] : [])),
  )
  const configuredTargetScopes = new Map(
    resourceScopes.map((configuration) => [configuration.resourceServerId, new Set(configuration.scopes)]),
  )
  const policyPairs = new Set<string>()
  for (const policy of policies) {
    const targetKey =
      'targetResourceServerId' in policy
        ? `resource:${policy.targetResourceServerId}`
        : `application:${policy.targetApplicationId}`
    const pair = `${policy.sourceResourceServerId}\u0000${targetKey}`
    if (policyPairs.has(pair)) {
      throw badRequest('Each token exchange source and target pair must appear only once.')
    }
    policyPairs.add(pair)
    const source = resources.get(policy.sourceResourceServerId)
    if (!source?.enabled) throw badRequest('Token exchange policy source Resource Server must be active.')
    if (source.visibility === 'private' && source.ownerOrganizationId !== ownerOrganizationId) {
      throw badRequest('Token exchange policy source Resource Server must be visible to the Application tenant.')
    }
    if ('targetApplicationId' in policy) {
      const target = targetApplications.get(policy.targetApplicationId)
      if (
        !target ||
        target.disabled ||
        target.visibility !== 'private' ||
        target.ownerOrganizationId !== ownerOrganizationId ||
        !target.oidcScopes.includes('openid') ||
        !target.oidcScopes.includes('groups')
      ) {
        throw badRequest(
          'Token exchange target Application must be an active private OIDC Application in the same Organization with openid and groups scopes.',
        )
      }
      continue
    }
    const target = resources.get(policy.targetResourceServerId)
    if (!target?.enabled) throw badRequest('Token exchange policy target Resource Server must be active.')
    if (target.visibility === 'private' && target.ownerOrganizationId !== ownerOrganizationId) {
      throw badRequest('Token exchange policy target Resource Server must be visible to the Application tenant.')
    }
    const sourceScopes = new Set(source.scopeRegistry?.scopes.map((scope) => scope.value) ?? [])
    const targetScopes = new Set(target.scopeRegistry?.scopes.map((scope) => scope.value) ?? [])
    const configuredScopes = configuredTargetScopes.get(target.id) ?? new Set<string>()
    const mappings = new Set<string>()
    for (const mapping of policy.scopeMappings) {
      const mappingPair = `${mapping.sourceScope}\u0000${mapping.targetScope}`
      if (mappings.has(mappingPair)) throw badRequest('Token exchange scope mappings must be unique within a policy.')
      mappings.add(mappingPair)
      if (!sourceScopes.has(mapping.sourceScope)) {
        throw badRequest('Token exchange policy contains an undeclared source Resource Server scope.')
      }
      if (!targetScopes.has(mapping.targetScope)) {
        throw badRequest('Token exchange policy contains an undeclared target Resource Server scope.')
      }
      if (!configuredScopes.has(mapping.targetScope)) {
        throw badRequest('Token exchange policy target scopes must be configured on the Application.')
      }
    }
  }
  return policies
}

async function resolveRequestedResource(deps: Deps, resourceUrl: string | undefined, userId: string) {
  if (!resourceUrl) return null
  const resource = await deps.authorization.findResourceByResourceUrl(resourceUrl)
  if (!resource) throw badRequest('Requested Resource Server is not active.')
  return requireResourceVisibleToUser(deps, resource.id, userId)
}

function authorizationParameterValues(params: URLSearchParams | Record<string, string> | undefined, name: string) {
  if (!params) return []
  const values = params instanceof URLSearchParams ? params.getAll(name) : params[name] ? [params[name]] : []
  return [...new Set(values)]
}

function oidcScopeDescription(scope: string) {
  if (scope === 'openid') return 'Confirm your identity with Realmroot.'
  if (scope === 'profile') return 'Share basic profile details such as your name and avatar.'
  if (scope === 'email') return 'Share your email address and verification status.'
  if (scope === 'offline_access') return 'Allow continued access when you are away.'
  return null
}

async function requireResourceVisibleToUser(deps: Deps, resourceId: string, userId: string) {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource?.enabled) throw badRequest('Requested Resource Server is not active.')
  if (resource.visibility === 'public') return resource
  const membership = await deps.authorization.findMemberByOrganizationUser(resource.ownerOrganizationId, userId)
  if (!membership) throw badRequest('Requested Resource Server is not visible to the current user.')
  return resource
}

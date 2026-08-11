import {
  ApiError,
  badGateway,
  badRequest,
  conflict,
  forbidden,
  notFound,
  OAuthError,
  oauthError,
  unauthorized,
} from '@server/domain/errors'
import { isRealmrootResourceServer } from '@server/domain/realmroot-resource-server'
import type { Deps } from '@server/usecases/deps'
import type {
  AgentAccessRequestRecord,
  AgentConnectionRequestRecord,
  ExternalResourceAuthorizationRecord,
  ProviderResourceAuthorizationRecord,
  ResourceScopeEntitlementRecord,
} from '@server/usecases/ports'
import type {
  AccessRequest,
  AccessRequestApproval,
  AccountConnection,
  AgentPermission,
  CreateAccessRequest,
  CreateAccountConnection,
  CreateResourceConnectionRequest,
  ListAgentPermissionsQuery,
  ResourceConnectionApproval,
  ResourceConnectionRequest,
} from '@shared/api/agent-api'
import type { ApiResourceResponse, ResourceScopeRegistry } from '@shared/api/authorization'
import {
  type AuthorizationDetail,
  authorizationDetailCatalogSchema,
  authorizationDetailsSchema,
} from '@shared/api/authorization-details'
import type {
  CreateAgentAccessRequest,
  CreateResourceConnectionIntentRequest,
  DecideAgentAccessRequest,
  ProviderAuthorityConstraint,
} from '@shared/api/external-resources'
import { providerAuthorityConstraintsSchema } from '@shared/api/external-resources'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'
import { agentBootstrapScopes, realmrootOAuthScopes } from '@shared/authz'
import { realmrootManagementScopes } from '@shared/scope-registry'
import { ensureDynamicConnectorScopes, refreshDynamicConnectorMetadata } from './connectors'
import { validateDpopTokenProof } from './dpop'
import { organizationUserHasScope, resolveOrganizationMembershipScopes } from './organization-membership-scopes'
import { validateRequestedScopes } from './resource-openapi'
import { resourceScopeEntitlementLifecycle, userEffectiveResourceScopes } from './resource-scope-entitlements'
import { activePublicResource, activeResourceVisibleToOrganization } from './resource-visibility'

const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
const jwtBearerGrantType = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'
const externalAuthorizationTimeoutMs = 5_000
export interface AgentResourcePrincipal {
  issuer: string
  subject: string
  identityId: string
  protocolAgentId: string
  hostId: string
}

export interface AgentAssertionSigner {
  issuer: string
  sign(payload: Record<string, unknown>, type: 'JWT' | 'at+jwt'): Promise<string>
}

type ResolvedExternalAuthorization = ExternalResourceAuthorizationRecord

export async function getExternalResourceAuthorization(deps: Deps, resourceId: string) {
  await requireExternalResource(deps, resourceId)
  const authorization = await findExternalAuthorization(deps, resourceId)
  if (!authorization) throw notFound('External API resource authorization was not found.')
  return toExternalAuthorization(authorization)
}

async function getApiResourceConfiguration(deps: Deps, resourceId: string) {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource) throw notFound('API resource was not found.')
  const authorization = await findExternalAuthorization(deps, resourceId)
  return {
    ...resource,
    authorization: authorization ? omitResourceId(toExternalAuthorization(authorization)) : null,
  }
}

export async function getApiResource(deps: Deps, resourceId: string, apiOrigin: string) {
  return toResourceServer(await getApiResourceConfiguration(deps, resourceId), apiOrigin, null)
}

export async function listApiResources(
  deps: Deps,
  pagination: PaginationInput,
  apiOrigin: string,
  ownerOrganizationIds?: string[],
) {
  const page = await deps.authorization.listResources(pagination, ownerOrganizationIds)
  return {
    items: await Promise.all(page.items.map((resource) => getApiResource(deps, resource.id, apiOrigin))),
    pagination: page.pagination,
  }
}

export async function createResourceConnectionIntent(
  deps: Deps,
  resourceId: string,
  input: CreateResourceConnectionIntentRequest,
  actorUserId: string,
  callbackOrigin: string,
  signer?: AgentAssertionSigner,
) {
  const candidate = await deps.authorization.findResource(resourceId)
  if (!candidate) throw notFound('External API resource was not found.')
  if (!candidate.enabled) throw notFound('Enabled external API resource was not found.')
  const resource = await requireEnabledResource(deps, resourceId)
  if (!requiresAccountConnection(resource))
    throw badRequest('Realmroot-issued access does not use account connections.')
  if (!resource.connectorId) throw new Error('Provider-connected access requires a Provider Connector.')
  const broker = brokeredAccountConnection(resource)
  await requireConnectionOwnerControl(deps, input.owner, actorUserId)
  const scopes = input.scopes
  validateRequestedScopes(resource.scopeRegistry, scopes)
  if (broker) {
    if (!signer) throw new Error('Brokered account connections require Realmroot signing.')
    const id = deps.ids.generate()
    const state = randomToken()
    const verifier = randomToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
    const callbackUri = resourceConnectionCallbackUrl(callbackOrigin)
    const authorizationDetails = input.authorizationDetails ?? resource.authorizationDetails
    const existing = await deps.externalResources.findProviderConnectionByOwnerConnector({
      connectorId: resource.connectorId,
      ownerUserId: input.owner.type === 'user' ? actorUserId : null,
      ownerOrganizationId: input.owner.type === 'organization' ? input.owner.organizationId : null,
    })
    const connectionId = existing?.id ?? id
    const request = await signer.sign(
      {
        iss: signer.issuer,
        sub: input.owner.type === 'user' ? actorUserId : input.owner.organizationId,
        aud: resource.resourceUrl,
        jti: id,
        iat: Math.floor(now.getTime() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        state,
        connection_id: connectionId,
        expected_external_subject: existing?.status === 'active' ? existing.externalSubject : null,
        owner_type: input.owner.type,
        callback_uri: callbackUri,
        code_challenge: await sha256(verifier),
        code_challenge_method: 'S256',
        scope: scopes.join(' '),
        authorization_details: authorizationDetails,
      },
      'JWT',
    )
    const authorizationUrl = new URL(broker.authorizationEndpoint)
    authorizationUrl.searchParams.set('request', request)
    const created = await deps.externalResources.createConnectionIntent({
      id,
      stateHash: await sha256(state),
      resourceId,
      ownerUserId: input.owner.type === 'user' ? actorUserId : null,
      ownerOrganizationId: input.owner.type === 'organization' ? input.owner.organizationId : null,
      initiatedByUserId: actorUserId,
      scopes,
      authorizationDetails,
      encryptedPkceVerifier: await deps.secrets.seal(verifier, connectionIntentContext(id)),
      authorizationMode: 'brokered',
      clientGeneration: 1,
      returnTo: input.returnTo ?? 'account-center',
      status: 'pending',
      expiresAt,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    if (!created) throw notFound('Enabled native API resource was not found.')
    return {
      id,
      resourceId,
      owner:
        input.owner.type === 'organization'
          ? { type: 'organization' as const, organizationId: input.owner.organizationId }
          : { type: 'user' as const, userId: actorUserId },
      authorizationUrl: authorizationUrl.toString(),
      authorizationDetails,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
  }
  const connectorBackedNative = resource.accessMode === 'realmroot'
  const currentAuthorization = await requireActiveConnectorAuthorization(deps, resourceId)
  const requestedScopes = [
    ...new Set([
      ...scopes,
      'openid',
      'offline_access',
      ...(currentAuthorization.authorizationDetailsCatalogScope
        ? [currentAuthorization.authorizationDetailsCatalogScope]
        : []),
    ]),
  ].sort()
  const clientGeneration = await ensureDynamicConnectorScopes(
    deps,
    resource.connectorId!,
    requestedScopes,
    callbackOrigin,
  )
  const authorization = await requireActiveConnectorAuthorization(deps, resourceId, clientGeneration)
  const authorizationDetails = input.authorizationDetails ?? resource.authorizationDetails
  assertAuthorizationDetailsSupported(authorizationDetails, authorization)
  const id = deps.ids.generate()
  const state = randomToken()
  const verifier = randomToken()
  const now = new Date()
  const redirectUri = resourceConnectionCallbackUrl(callbackOrigin)
  const authorizationParameters = {
    response_type: 'code',
    prompt: 'consent',
    client_id: authorization.clientId,
    redirect_uri: redirectUri,
    scope: requestedScopes.join(' '),
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    ...(connectorBackedNative ? {} : { resource: resource.resourceUrl }),
    ...(authorizationDetails.length > 0 ? { authorization_details: JSON.stringify(authorizationDetails) } : {}),
  }
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  let authorizationUrl: string
  if (!connectorBackedNative && authorizationDetails.length > 0) {
    const pushed = await postPushedAuthorizationRequest(
      deps,
      authorization.pushedAuthorizationRequestEndpoint!,
      authorizationParameters,
      authorization.clientId,
      authorizationClientSecret(authorization),
    )
    const requestUri = requiredString(pushed, 'request_uri', 'Pushed authorization response')
    requiredPositiveInteger(pushed, 'expires_in', 'Pushed authorization response')
    const url = new URL(authorization.authorizationEndpoint)
    url.searchParams.set('client_id', authorization.clientId)
    url.searchParams.set('request_uri', requestUri)
    authorizationUrl = url.toString()
  } else {
    const url = new URL(authorization.authorizationEndpoint)
    for (const [name, value] of Object.entries(authorizationParameters)) url.searchParams.set(name, value)
    authorizationUrl = url.toString()
  }
  const created = await deps.externalResources.createConnectionIntent({
    id,
    stateHash: await sha256(state),
    resourceId,
    ownerUserId: input.owner.type === 'user' ? actorUserId : null,
    ownerOrganizationId: input.owner.type === 'organization' ? input.owner.organizationId : null,
    initiatedByUserId: actorUserId,
    scopes: requestedScopes,
    authorizationDetails,
    encryptedPkceVerifier: await deps.secrets.seal(verifier, connectionIntentContext(id)),
    authorizationMode: 'oauth',
    clientGeneration,
    returnTo: input.returnTo ?? 'account-center',
    status: 'pending',
    expiresAt,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  if (!created) throw notFound('Enabled external API resource was not found.')
  return {
    id,
    resourceId,
    owner:
      input.owner.type === 'organization'
        ? { type: 'organization' as const, organizationId: input.owner.organizationId }
        : { type: 'user' as const, userId: actorUserId },
    authorizationUrl,
    authorizationDetails,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export async function completeResourceConnectionIntent(
  deps: Deps,
  input: { state: string; code: string },
  callbackOrigin: string,
) {
  const now = new Date()
  const intent = await deps.externalResources.consumeConnectionIntent(await sha256(input.state), now)
  if (!intent) throw badRequest('Resource connection state is invalid, expired, or already used.')
  if (intent.authorizationMode === 'brokered') {
    return completeBrokeredResourceConnectionIntent(deps, intent, input.code)
  }
  const authorization = await requireActiveConnectorAuthorization(deps, intent.resourceId, intent.clientGeneration ?? 1)
  const clientSecret = authorizationClientSecret(authorization)
  const verifier = await deps.secrets.open(intent.encryptedPkceVerifier, connectionIntentContext(intent.id))
  const token = await postForm(
    deps,
    authorization.tokenEndpoint,
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: resourceConnectionCallbackUrl(callbackOrigin),
      code_verifier: verifier,
    },
    authorization.clientId,
    clientSecret,
  )
  const accessToken = requiredString(token, 'access_token', 'OAuth token response')
  const refreshToken = requiredString(token, 'refresh_token', 'OAuth token response')
  const authorizationDetails = readAuthorizationDetails(
    token.authorization_details,
    intent.authorizationDetails.length > 0,
    intent.authorizationDetails.map((detail) => detail.type),
    'OAuth token response',
  )
  const profile = await fetchObject(
    deps,
    authorization.userInfoEndpoint!,
    'OIDC userinfo request failed.',
    new Headers({ authorization: `Bearer ${accessToken}` }),
  )
  const externalSubject = requiredString(profile, 'sub', 'OIDC userinfo response')
  const displayName =
    optionalString(profile, 'name') ?? optionalString(profile, 'preferred_username') ?? externalSubject
  const expiresAt = tokenExpiry(token, now)
  const resource = await requireEnabledResource(deps, intent.resourceId)
  const provider = await ensureProviderConnection(deps, resource, intent, externalSubject, displayName, now)
  const existing = await deps.externalResources.findConnectionByOwnerResource({
    resourceId: intent.resourceId,
    ownerUserId: intent.ownerUserId,
    ownerOrganizationId: intent.ownerOrganizationId,
  })
  const connectionId = existing?.id ?? intent.id
  const grantedScopes = scopeString(token.scope) ?? intent.scopes
  const authorizationInput = {
    credentialCustody: 'realmroot' as const,
    encryptedTokens: await deps.secrets.seal(
      JSON.stringify({ accessToken, refreshToken, scope: grantedScopes.join(' ') }),
      connectionTokensContext(connectionId),
    ),
    brokerReference: null,
    grantedScopes,
    authorizationDetails,
    authorityConstraints: [],
    clientGeneration: intent.clientGeneration ?? 1,
    credentialVersion: (existing?.credentialVersion ?? 0) + 1,
    refreshClaimId: null,
    refreshClaimExpiresAt: null,
    status: 'active' as const,
    credentialExpiresAt: expiresAt,
    revokedAt: null,
    updatedAt: now,
  }
  const connection = existing
    ? await deps.externalResources.replaceConnectionAuthorization(existing.id, intent.resourceId, authorizationInput)
    : await deps.externalResources.createConnection({
        id: connectionId,
        providerConnectionId: provider.id,
        resourceId: intent.resourceId,
        ...authorizationInput,
        createdAt: now,
      })
  if (!connection) throw badRequest('The API resource was deleted while completing the connection.')
  if (existing) {
    await revokeUncoveredEntitlements(
      deps,
      connection,
      intent.authorizationDetails.length > 0,
      intent.initiatedByUserId,
      now,
    )
  }
  return {
    ...toResourceConnection(connection),
    returnTo: intent.returnTo,
  }
}

async function completeBrokeredResourceConnectionIntent(
  deps: Deps,
  intent: import('@server/usecases/ports').ResourceConnectionIntentRecord,
  code: string,
) {
  const resource = await requireEnabledResource(deps, intent.resourceId)
  const broker = brokeredAccountConnection(resource)
  if (!broker) throw badRequest('Resource Server no longer supports brokered account connections.')
  const verifier = await deps.secrets.open(intent.encryptedPkceVerifier, connectionIntentContext(intent.id))
  let response: Response
  try {
    response = await deps.externalHttp.fetch(
      new Request(broker.tokenEndpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, code_verifier: verifier, connection_id: intent.id }),
      }),
    )
  } catch {
    throw badGateway('Brokered account connection service is unavailable.')
  }
  if (!response.ok) throw unauthorized('Resource Server rejected the brokered account connection code.')
  const result = await readObject(response, 'Brokered account connection response is invalid.')
  const externalSubject = requiredString(result, 'external_subject', 'Brokered account connection response')
  const displayName = requiredString(result, 'display_name', 'Brokered account connection response')
  const brokerReference = requiredString(result, 'broker_reference', 'Brokered account connection response')
  const grantedScopes = scopeString(result.scope) ?? intent.scopes
  assertScopeSubset(intent.scopes, grantedScopes, 'brokered account connection')
  const authorizationDetails = authorizationDetailsSchema.parse(result.authorization_details ?? [])
  const authorityConstraints =
    result.authority_constraints === undefined
      ? authorizationDetails.map((authorizationDetail) => ({
          authorizationDetails: [authorizationDetail],
          scopes: grantedScopes,
        }))
      : providerAuthorityConstraintsSchema.parse(result.authority_constraints)
  if (resource.authorizationDetails.length > 0) {
    assertConcreteAuthorizationDetails(resource.authorizationDetails, authorizationDetails, 'Brokered connection')
  } else if (authorizationDetails.length > 0) {
    throw invalidAuthorizationDetails('Brokered connection returned unsupported authorization details.')
  }
  validateAuthorityConstraints(authorityConstraints, authorizationDetails, grantedScopes)
  const now = new Date()
  const provider = await ensureProviderConnection(deps, resource, intent, externalSubject, displayName, now)
  const existing = await deps.externalResources.findConnectionByOwnerResource({
    resourceId: intent.resourceId,
    ownerUserId: intent.ownerUserId,
    ownerOrganizationId: intent.ownerOrganizationId,
  })
  const connectionId = existing?.id ?? intent.id
  const authorizationInput = {
    credentialCustody: 'resource_server' as const,
    encryptedTokens: null,
    brokerReference,
    grantedScopes,
    authorizationDetails,
    authorityConstraints,
    clientGeneration: 1,
    credentialVersion: (existing?.credentialVersion ?? 0) + 1,
    refreshClaimId: null,
    refreshClaimExpiresAt: null,
    status: 'active' as const,
    credentialExpiresAt: null,
    revokedAt: null,
    updatedAt: now,
    ...(existing && existing.brokerReference !== brokerReference
      ? { providerEventOccurredAt: null, providerEventRevision: null }
      : {}),
  }
  const connection = existing
    ? await deps.externalResources.replaceConnectionAuthorization(existing.id, intent.resourceId, authorizationInput)
    : await deps.externalResources.createConnection({
        id: connectionId,
        providerConnectionId: provider.id,
        resourceId: intent.resourceId,
        ...authorizationInput,
        createdAt: now,
      })
  if (!connection) throw badRequest('Resource Server was deleted while completing the connection.')
  if (existing) {
    await revokeUncoveredEntitlements(
      deps,
      connection,
      intent.authorizationDetails.length > 0,
      intent.initiatedByUserId,
      now,
    )
  }
  return { ...toResourceConnection(connection), returnTo: intent.returnTo }
}

async function ensureProviderConnection(
  deps: Deps,
  resource: ApiResourceResponse,
  intent: import('@server/usecases/ports').ResourceConnectionIntentRecord,
  externalSubject: string,
  displayName: string,
  now: Date,
) {
  if (!resource.connectorId) throw badRequest('API resource no longer has a Provider Connector.')
  const existing = await deps.externalResources.findProviderConnectionByOwnerConnector({
    connectorId: resource.connectorId,
    ownerUserId: intent.ownerUserId,
    ownerOrganizationId: intent.ownerOrganizationId,
  })
  if (existing?.status === 'active' && existing.externalSubject !== externalSubject) {
    throw badRequest('Disconnect the current Provider account before connecting another account.')
  }
  if (intent.ownerUserId) {
    const subjectOwner = await deps.externalResources.findActiveUserProviderConnectionBySubject({
      connectorId: resource.connectorId,
      externalSubject,
    })
    if (subjectOwner && subjectOwner.ownerUserId !== intent.ownerUserId) {
      throw conflict('This Provider account is already connected to another Realmroot account.')
    }
  }
  return deps.externalResources.upsertProviderConnection({
    id: existing?.id ?? deps.ids.generate(),
    connectorId: resource.connectorId,
    ownerUserId: intent.ownerUserId,
    ownerOrganizationId: intent.ownerOrganizationId,
    authenticationAccountId: existing?.authenticationAccountId ?? null,
    externalSubject,
    displayName,
    status: 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}

export async function failResourceConnectionIntent(deps: Deps, state: string) {
  const intent = await deps.externalResources.consumeConnectionIntent(await sha256(state), new Date())
  if (!intent) throw badRequest('Resource connection state is invalid, expired, or already used.')
  return { returnTo: intent.returnTo }
}

export async function listResourceConnections(deps: Deps, actorUserId: string) {
  const connections = await deps.externalResources.listConnectionsByUser(actorUserId)
  return { connections: connections.map(toResourceConnection) }
}

export async function createAccountConnection(
  deps: Deps,
  input: CreateAccountConnection,
  actorUserId: string,
  callbackOrigin: string,
  signer?: AgentAssertionSigner,
): Promise<AccountConnection> {
  if (input.context === 'connection-request') {
    const approval = await resolveResourceConnectionApproval(deps, input.approvalToken, actorUserId)
    const owner = approval.identity.identity.ownerOrganizationId
      ? { type: 'organization' as const, organizationId: approval.identity.identity.ownerOrganizationId }
      : { type: 'user' as const }
    const connectionScopes = expandedConnectionScopes(
      approval.connection,
      approval.request.scopes,
      approval.resource.scopeRegistry,
    )
    const pending = await createResourceConnectionIntent(
      deps,
      approval.request.resourceId,
      {
        owner,
        scopes: connectionScopes,
        authorizationDetails:
          approval.request.authorizationDetails.length > 0
            ? mergeAuthorizationDetails(
                approval.connection?.authorizationDetails ?? [],
                approval.request.authorizationDetails,
              )
            : undefined,
        returnTo: 'connection-approval',
      },
      actorUserId,
      callbackOrigin,
      signer,
    )
    return toPendingAccountConnection(pending, connectionScopes)
  }
  if (input.context === 'access-request') {
    const request = await requirePendingAccessRequestByToken(deps, input.approvalToken)
    if (request.id !== input.accessRequestId) throw notFound('Agent access request was not found.')
    const controlledConnection = await requireControlledRequestTarget(deps, request, actorUserId)
    const resource = await requireEnabledResource(deps, request.resourceId)
    if (resource.accessMode === 'realmroot') {
      throw badRequest('Native API resources do not use account connections.')
    }
    const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
    if (!identity) throw notFound('Active Agent identity was not found.')
    const owner = identity.identity.ownerOrganizationId
      ? { type: 'organization' as const, organizationId: identity.identity.ownerOrganizationId }
      : { type: 'user' as const }
    const ownerConnection = await deps.externalResources.findConnectionByOwnerResource({
      resourceId: request.resourceId,
      ownerUserId: identity.identity.ownerUserId,
      ownerOrganizationId: identity.identity.ownerOrganizationId,
    })
    const connectionScopes = expandedConnectionScopes(
      controlledConnection ?? ownerConnection,
      request.scopes,
      resource.scopeRegistry,
    )
    const pending = await createResourceConnectionIntent(
      deps,
      request.resourceId,
      { owner, scopes: connectionScopes, returnTo: 'access-approval' },
      actorUserId,
      callbackOrigin,
      signer,
    )
    return toPendingAccountConnection(pending, connectionScopes)
  }
  const pending = await createResourceConnectionIntent(
    deps,
    input.apiResourceId,
    { owner: input.owner, scopes: input.scopes, returnTo: 'account-center' },
    actorUserId,
    callbackOrigin,
    signer,
  )
  return toPendingAccountConnection(pending, input.scopes)
}

function expandedConnectionScopes(
  connection: ProviderResourceAuthorizationRecord | null,
  requestedScopes: string[],
  scopeRegistry: ResourceScopeRegistry | null,
) {
  const declaredScopes = new Set(scopeRegistry?.scopes.map((scope) => scope.value) ?? [])
  const existingScopes =
    connection?.status === 'active' ? connection.grantedScopes.filter((scope) => declaredScopes.has(scope)) : []
  return [...new Set([...existingScopes, ...requestedScopes])].sort()
}

export async function listAccountConnections(deps: Deps, actorUserId: string, pagination: PaginationInput) {
  const connections = (await deps.externalResources.listConnectionsByUser(actorUserId)).map(toAccountConnection)
  return {
    items: connections.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: paginationMetadata({ ...pagination, total: connections.length }),
  }
}

export async function listAccessRequestConnections(
  deps: Deps,
  approvalToken: string,
  actorUserId: string,
  pagination: PaginationInput,
) {
  const request = await requirePendingAccessRequestByToken(deps, approvalToken)
  await requireControlledRequestTarget(deps, request, actorUserId)
  const resource = await requireEnabledResource(deps, request.resourceId)
  if (!requiresAccountConnection(resource)) {
    return { items: [], pagination: paginationMetadata({ ...pagination, total: 0 }) }
  }
  const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
  if (!identity) throw notFound('Active Agent identity was not found.')
  const resourceConnections = (
    identity.identity.ownerOrganizationId
      ? await deps.externalResources.listConnectionsByOrganizations([identity.identity.ownerOrganizationId])
      : await deps.externalResources.listConnectionsByUser(identity.identity.ownerUserId!)
  ).filter((connection) => connection.resourceId === request.resourceId && connection.status === 'active')
  if (resourceConnections.length > 1) {
    throw new Error('A resource home space cannot have more than one active account connection.')
  }
  const connections = resourceConnections.map(toAccountConnection)
  return {
    items: connections.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: paginationMetadata({ ...pagination, total: connections.length }),
  }
}

export async function getAccountConnection(
  deps: Deps,
  connectionId: string,
  actorUserId: string,
): Promise<AccountConnection> {
  return toAccountConnection(await requireControlledConnection(deps, connectionId, actorUserId))
}

export async function listConnectableExternalResources(deps: Deps) {
  const resources = (await deps.authorization.listEnabledResources()).filter(
    (resource) => resource.accessMode !== 'realmroot',
  )
  const connectable = []
  for (const resource of resources) {
    if (brokeredAccountConnection(resource)) {
      connectable.push({
        id: resource.id,
        identifier: resource.identifier,
        name: resource.name,
        resourceUrl: resource.resourceUrl,
      })
      continue
    }
    const authorization = await findExternalAuthorization(deps, resource.id)
    if (authorization?.status !== 'active') continue
    connectable.push({
      id: resource.id,
      identifier: resource.identifier,
      name: resource.name,
      resourceUrl: authorization.resourceUrl,
    })
  }
  return { resources: connectable }
}

export async function listAccountProviderConnectors(deps: Deps, pagination: PaginationInput) {
  const connectors = await deps.connectors.listEnabled()
  const resources = await deps.authorization.listEnabledResources()
  const items = connectors.map((connector) => providerConnectorProjection(connector, resources))
  return {
    items: items.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: paginationMetadata({ ...pagination, total: items.length }),
  }
}

export async function listAccountProviderConnections(deps: Deps, actorUserId: string, pagination: PaginationInput) {
  const connections = await deps.externalResources.listProviderConnectionsByUser(actorUserId)
  const resources = await deps.authorization.listEnabledResources()
  const items = connections.map((connection) => {
    const connector = providerConnectorProjection(connection.connector, resources)
    return {
      id: connection.id,
      connector,
      displayName: connection.displayName,
      externalSubject: connection.externalSubject,
      capabilities: {
        signIn: {
          available: connector.capabilities.signIn.available,
          active: connection.authenticationAccountId !== null,
        },
        agentAccess: {
          available: connector.capabilities.agentAccess.available,
          active: connection.resourceAuthorizationCount > 0,
          authorizationCount: connection.resourceAuthorizationCount,
          resourceNames: connection.resourceNames,
        },
      },
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    }
  })
  return {
    items: items.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: paginationMetadata({ ...pagination, total: items.length }),
  }
}

function providerConnectorProjection(
  connector: import('@server/usecases/ports').ProviderConnectorSummary,
  resources: ApiResourceResponse[],
) {
  const providerResources = resources.filter(
    (resource) => resource.connectorId === connector.id && resource.availableToAgents,
  )
  const providerAuthorizationAvailable = providerResources.some((resource) => brokeredAccountConnection(resource))
  return {
    id: connector.id,
    slug: connector.slug,
    providerId: connector.providerId,
    providerType: connector.providerType,
    displayName: connector.displayName,
    capabilities: {
      signIn: { available: connector.loginEnabled },
      agentAccess: { available: providerResources.length > 0 },
      connection: {
        method: providerAuthorizationAvailable
          ? ('provider_authorization' as const)
          : connector.loginEnabled
            ? ('sign_in' as const)
            : null,
      },
    },
  }
}

export async function createProviderConnectionIntent(
  deps: Deps,
  connectorId: string,
  actorUserId: string,
  callbackOrigin: string,
  signer?: AgentAssertionSigner,
) {
  const connector = await deps.connectors.findById(connectorId)
  if (!connector?.enabled) throw notFound('Enabled Provider Connector was not found.')
  const resources = (await deps.authorization.listEnabledResources()).filter(
    (resource) => resource.connectorId === connectorId && brokeredAccountConnection(resource),
  )
  if (resources.length === 0) throw badRequest('Provider Connector does not support direct account connection.')
  if (resources.length > 1) {
    throw badRequest('Provider Connector has more than one account connection authority.')
  }
  const resource = resources[0]!
  const scopes = resource.scopeRegistry?.scopes.map((scope) => scope.value) ?? []
  if (scopes.length === 0) throw badRequest('Provider account connection authority does not declare any scopes.')
  const intent = await createResourceConnectionIntent(
    deps,
    resource.id,
    { owner: { type: 'user' }, scopes, returnTo: 'account-center' },
    actorUserId,
    callbackOrigin,
    signer,
  )
  return {
    id: intent.id,
    connectorId,
    authorizationUrl: intent.authorizationUrl,
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
  }
}

export async function disconnectProviderConnection(
  deps: Deps,
  connectionId: string,
  actorUserId: string,
  signer?: AgentAssertionSigner,
) {
  const connection = await deps.externalResources.findProviderConnection(connectionId)
  if (!connection || connection.ownerUserId !== actorUserId) throw notFound('Provider Connection was not found.')
  if (connection.authenticationAccountId) {
    const accounts = await deps.users.listLinkedAccounts(actorUserId, { limit: 2, offset: 0 })
    if (accounts.total <= 1) throw badRequest('Add another sign-in method before disconnecting this Provider.')
  }
  const authorizations = (await deps.externalResources.listConnectionsByUser(actorUserId)).filter(
    (authorization) => authorization.providerConnectionId === connectionId && authorization.status === 'active',
  )
  for (const authorization of authorizations) {
    await revokeBrokeredProviderAuthorization(deps, authorization, connection, actorUserId, signer)
  }
  for (const authorization of authorizations) await revokeResourceConnection(deps, authorization.id, actorUserId)
  if (!(await deps.externalResources.revokeProviderConnection(connectionId, actorUserId, new Date()))) {
    throw badRequest('Provider Connection is already disconnected.')
  }
}

async function revokeBrokeredProviderAuthorization(
  deps: Deps,
  authorization: ProviderResourceAuthorizationRecord,
  connection: import('@server/usecases/ports').ProviderConnectionRecord,
  actorUserId: string,
  signer?: AgentAssertionSigner,
) {
  if (authorization.credentialCustody !== 'resource_server' || !authorization.brokerReference) return
  const resource = await deps.authorization.findResource(authorization.resourceId)
  const endpoint = resource && brokeredAccountConnection(resource)?.revocationEndpoint
  if (!resource || !endpoint) return
  if (!signer) throw new Error('Brokered account connection revocation requires Realmroot signing.')
  const now = new Date()
  const request = await signer.sign(
    {
      iss: signer.issuer,
      sub: actorUserId,
      aud: resource.resourceUrl,
      jti: createProtocolId('resconnrev'),
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 60,
      connection_id: connection.id,
      resource_authorization_id: authorization.id,
      broker_reference: authorization.brokerReference,
    },
    'JWT',
  )
  let response: Response
  try {
    response = await deps.externalHttp.fetch(
      new Request(endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ request }),
      }),
    )
  } catch {
    throw badGateway('Brokered account connection revocation service is unavailable.')
  }
  if (!response.ok) throw badGateway('Resource Server rejected brokered account connection revocation.')
}

export async function revokeResourceConnection(deps: Deps, connectionId: string, actorUserId: string) {
  const connection = await requireControlledConnection(deps, connectionId, actorUserId)
  await revokeRealmrootCustodiedProviderAuthorization(deps, connection)
  const entitlements = await deps.externalResources.listActiveEntitlementsByConnection(connection.id, new Date())
  for (const entitlement of entitlements) await revokeAgentPermission(deps, entitlement.id, actorUserId)
  if (!(await deps.externalResources.revokeConnection(connectionId, new Date()))) {
    throw badRequest('Resource account connection is already revoked.')
  }
}

async function revokeRealmrootCustodiedProviderAuthorization(
  deps: Deps,
  connection: ProviderResourceAuthorizationRecord,
) {
  if (connection.credentialCustody !== 'realmroot' || !connection.encryptedTokens) return
  const resource = await deps.authorization.findResource(connection.resourceId)
  if (!resource) throw notFound('Resource Server was not found.')
  const authorization = await connectorOAuthAuthorization(deps, resource, connection.clientGeneration ?? 1)
  if (!authorization) throw badGateway('Provider authorization configuration is unavailable.')
  const payload = JSON.parse(
    await deps.secrets.open(connection.encryptedTokens, connectionTokensContext(connection.id)),
  ) as Record<string, unknown>
  const clientSecret = authorizationClientSecret(authorization)
  await postEmptyForm(
    deps,
    authorization.revocationEndpoint,
    {
      token: requiredString(payload, 'refreshToken', 'Stored resource connection'),
      token_type_hint: 'refresh_token',
    },
    authorization.clientId,
    clientSecret,
  )
  await postEmptyForm(
    deps,
    authorization.revocationEndpoint,
    {
      token: requiredString(payload, 'accessToken', 'Stored resource connection'),
      token_type_hint: 'access_token',
    },
    authorization.clientId,
    clientSecret,
  )
}

export async function discoverAgentResources(deps: Deps, principal: AgentResourcePrincipal) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const visibleOrganizationIds = await activeIdentityOrganizationIds(deps, identity.identity)
  const connections = identity.identity.ownerUserId
    ? await deps.externalResources.listConnectionsByUser(identity.identity.ownerUserId)
    : await deps.externalResources.listConnectionsByOrganizations([identity.identity.ownerOrganizationId!])
  const activeConnections = connections.filter((connection) => connection.status === 'active')
  const configuredResources = await deps.authorization.listEnabledResources()
  const visibleResourceIds = new Set([
    ...activeConnections.map((connection) => connection.resourceId),
    ...configuredResources.map((resource) => resource.id),
  ])
  const resources = await Promise.all(
    [...visibleResourceIds].map(async (resourceId) => {
      const resource = await deps.authorization.findResource(resourceId)
      const authorization = await findExternalAuthorization(deps, resourceId)
      if (
        !resource?.enabled ||
        !resource.availableToAgents ||
        !activeResourceVisibleToAgent(resource, visibleOrganizationIds) ||
        (resource.accessMode === 'external_oauth' && authorization?.status !== 'active')
      ) {
        return null
      }
      const scopes = discoverAgentResourceScopes(resource)
      const connection = activeConnections.find((candidate) => candidate.resourceId === resourceId) ?? null
      return {
        id: resource.id,
        identifier: resource.identifier,
        name: resource.name,
        description: resource.description,
        availability: {
          status: scopes ? ('available' as const) : ('unavailable' as const),
          checkedAt: new Date().toISOString(),
        },
        scopes: scopes ?? [],
        resourcesAvailable:
          !requiresAccountConnection(resource) ||
          Boolean(
            connection &&
              (authorization?.authorizationDetailsCatalogEndpoint || connection.authorizationDetails.length > 0),
          ),
        connection: !requiresAccountConnection(resource)
          ? { status: 'not_required' as const, displayName: null, authorizedScopes: [] }
          : connection
            ? {
                status: 'connected' as const,
                displayName: connection.displayName,
                authorizedScopes: connection.grantedScopes.filter(
                  (scope) =>
                    scope !== 'openid' &&
                    scope !== 'offline_access' &&
                    scope !== authorization?.authorizationDetailsCatalogScope,
                ),
              }
            : { status: 'not_connected' as const, displayName: null, authorizedScopes: [] },
      }
    }),
  )
  return { resources: resources.filter((resource) => resource !== null) }
}

function discoverAgentResourceScopes(
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
) {
  if (isRealmrootResourceServer(resource.id)) {
    return realmrootOAuthScopes.map((value) => ({ value, description: null }))
  }
  return resource.scopeRegistry?.scopes.map(({ value, description }) => ({ value, description })) ?? null
}

function validateResourceRequestedScopes(
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  scopes: string[],
) {
  if (isRealmrootResourceServer(resource.id)) {
    if (scopes.some((scope) => !realmrootOAuthScopes.includes(scope as (typeof realmrootOAuthScopes)[number]))) {
      throw badRequest('Requested scope is not declared by the Realmroot scope registry.')
    }
    return
  }
  validateRequestedScopes(resource.scopeRegistry, scopes)
}

export async function listAgentResourceServers(
  deps: Deps,
  principal: AgentResourcePrincipal,
  pagination: PaginationInput,
  apiOrigin: string,
) {
  const origin = apiOrigin.replace(/\/$/, '')
  const resources = await Promise.all(
    (await discoverAgentResources(deps, principal)).resources.map(async (resource) =>
      toResourceServer(await getApiResourceConfiguration(deps, resource.id), origin, resource.connection),
    ),
  )
  return {
    items: resources.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: paginationMetadata({ ...pagination, total: resources.length }),
  }
}

export async function getAgentResourceServer(
  deps: Deps,
  resourceServerId: string,
  principal: AgentResourcePrincipal,
  apiOrigin: string,
) {
  const resource = (await discoverAgentResources(deps, principal)).resources.find(
    (candidate) => candidate.id === resourceServerId,
  )
  if (!resource) throw notFound('Resource Server was not found.')
  return toResourceServer(
    await getApiResourceConfiguration(deps, resource.id),
    apiOrigin.replace(/\/$/, ''),
    resource.connection,
  )
}

export async function listAgentResourceServerAuthorizationDetails(
  deps: Deps,
  resourceServerId: string,
  principal: AgentResourcePrincipal,
  pagination: PaginationInput,
) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const resource = await requireEnabledResource(deps, resourceServerId)
  await requireAgentResourceVisibility(deps, resource, identity.identity)
  if (isRealmrootResourceServer(resource.id)) {
    const items = await realmrootAuthorityDetailsCatalog(deps, identity, principal.identityId, resource)
    return {
      items: items.slice(pagination.offset, pagination.offset + pagination.limit),
      pagination: paginationMetadata({ ...pagination, total: items.length }),
    }
  }
  if (!requiresAccountConnection(resource)) {
    return { items: [], pagination: paginationMetadata({ ...pagination, total: 0 }) }
  }
  const connection = await deps.externalResources.findConnectionByOwnerResource({
    resourceId: resourceServerId,
    ownerUserId: identity.identity.ownerUserId,
    ownerOrganizationId: identity.identity.ownerOrganizationId,
  })
  if (!connection || connection.status !== 'active') {
    return { items: [], pagination: paginationMetadata({ ...pagination, total: 0 }) }
  }
  const fallbackAuthorization = await serviceResourceFallbackAuthorization(deps, resource, connection)
  if (fallbackAuthorization) {
    return { items: [], pagination: paginationMetadata({ ...pagination, total: 0 }) }
  }
  const catalog = await readResourceCatalog(deps, resource, connection, principal.identityId, pagination)
  return {
    items: catalog.items.map(toResourceServerAuthorizationDetail),
    pagination: catalog.pagination,
  }
}

export async function createAgentConnectionRequest(
  deps: Deps,
  resourceServerId: string,
  input: CreateResourceConnectionRequest,
  principal: AgentResourcePrincipal,
  apiOrigin: string,
): Promise<ResourceConnectionRequest> {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const resource = await requireEnabledResource(deps, resourceServerId)
  if (!requiresAccountConnection(resource)) throw badRequest('Native Resource Servers do not use account connections.')
  if (resource.accessMode === 'external_oauth') await refreshDynamicConnectorMetadata(deps, resource.connectorId!)
  validateResourceRequestedScopes(resource, input.scopes)
  await requireAgentResourceVisibility(deps, resource, identity.identity)
  const connection = await deps.externalResources.findConnectionByOwnerResource({
    resourceId: resourceServerId,
    ownerUserId: identity.identity.ownerUserId,
    ownerOrganizationId: identity.identity.ownerOrganizationId,
  })
  const authorizationDetails = await resolveRequestedAuthorizationDetails(
    deps,
    resource,
    connection?.status === 'active' ? connection : null,
    input.authorizationDetails ?? [],
    identity,
  )
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  const requestId = deps.ids.generate()
  const rawApprovalToken = randomToken()
  const record: AgentConnectionRequestRecord = {
    id: requestId,
    resourceId: resource.id,
    agentIdentityId: principal.identityId,
    bindingId: identity.bindings.find(
      (candidate) => candidate.hostId === principal.hostId && candidate.protocolAgentId === principal.protocolAgentId,
    )!.id,
    scopes: [...new Set(input.scopes)].sort(),
    authorizationDetails,
    reason: input.reason ?? null,
    approvalTokenHash: await sha256(rawApprovalToken),
    encryptedApprovalToken: await deps.secrets.seal(rawApprovalToken, connectionRequestTokenContext(requestId)),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  }
  const created = await deps.externalResources.createAgentConnectionRequest(record)
  if (!created) throw forbidden('Enabled Resource Server is required.')
  const connected =
    connectionCoversRequest(connection, created) &&
    Boolean(connection && (await isConnectionUsable(deps, resource.id, connection)))
  return toResourceConnectionRequest(
    created,
    connected,
    apiOrigin,
    connected
      ? null
      : `${apiOrigin.replace(/\/$/, '')}/agent/resource-connection/approve#token=${encodeURIComponent(rawApprovalToken)}`,
  )
}

export async function getAgentConnectionRequest(
  deps: Deps,
  requestId: string,
  principal: AgentResourcePrincipal,
  apiOrigin: string,
) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const request = await deps.externalResources.findAgentConnectionRequest(requestId)
  const binding = identity.bindings.find(
    (candidate) =>
      candidate.id === request?.bindingId &&
      candidate.hostId === principal.hostId &&
      candidate.protocolAgentId === principal.protocolAgentId &&
      candidate.status === 'active',
  )
  if (!request || request.agentIdentityId !== principal.identityId || !binding) {
    throw notFound('Connection request was not found.')
  }
  const connection = await deps.externalResources.findConnectionByOwnerResource({
    resourceId: request.resourceId,
    ownerUserId: identity.identity.ownerUserId,
    ownerOrganizationId: identity.identity.ownerOrganizationId,
  })
  const connected =
    connectionCoversRequest(connection, request) &&
    Boolean(connection && (await isConnectionUsable(deps, request.resourceId, connection)))
  return toResourceConnectionRequest(request, connected, apiOrigin, null)
}

export async function getAccountResourceConnectionApproval(
  deps: Deps,
  approvalToken: string,
  actorUserId: string,
): Promise<ResourceConnectionApproval> {
  const approval = await resolveResourceConnectionApproval(deps, approvalToken, actorUserId)
  return {
    ...toResourceConnectionRequest(
      approval.request,
      connectionCoversRequest(approval.connection, approval.request),
      '',
      null,
    ),
    agent: { id: approval.identity.identity.id, name: approval.identity.identity.name },
    resource: { id: approval.resource.id, name: approval.resource.name },
    accountConnection: approval.connection?.status === 'active' ? toAccountConnection(approval.connection) : null,
  }
}

export async function listAccountAccessRequestAuthorizationDetailCatalog(
  deps: Deps,
  requestId: string,
  approvalToken: string,
  actorUserId: string,
  pagination: PaginationInput,
) {
  const request = await requirePendingAccessRequestByToken(deps, approvalToken)
  if (request.id !== requestId) throw notFound('Agent access request was not found.')
  const controlledConnection = await requireControlledRequestTarget(deps, request, actorUserId)
  const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
  if (!identity) throw notFound('Active Agent identity was not found.')
  const resource = await requireEnabledResource(deps, request.resourceId)
  if (!requiresAccountConnection(resource)) {
    throw badRequest('Native API resources do not have authorization detail catalogs.')
  }
  const connection =
    controlledConnection ??
    (await deps.externalResources.findConnectionByOwnerResource({
      resourceId: request.resourceId,
      ownerUserId: identity.identity.ownerUserId,
      ownerOrganizationId: identity.identity.ownerOrganizationId,
    }))
  if (!connection || connection.status !== 'active') {
    throw notFound('Active resource account connection was not found.')
  }
  return brokeredAccountConnection(resource)
    ? readResourceCatalog(deps, resource, connection, request.agentIdentityId, pagination)
    : readAuthorizationDetailCatalog(deps, resource, connection, request.agentIdentityId, pagination)
}

export async function createAgentAccessRequest(
  deps: Deps,
  input: CreateAgentAccessRequest,
  principal: AgentResourcePrincipal,
  approvalOrigin: string,
) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const resource = await requireEnabledResource(deps, input.resourceId)
  const connection = !requiresAccountConnection(resource)
    ? null
    : await deps.externalResources.findConnectionByOwnerResource({
        resourceId: resource.id,
        ownerUserId: identity.identity.ownerUserId,
        ownerOrganizationId: identity.identity.ownerOrganizationId,
      })
  if (requiresAccountConnection(resource)) {
    if (!connection || connection.status !== 'active') {
      throw notFound('Active resource account connection was not found.')
    }
  }
  validateResourceRequestedScopes(resource, input.scopes)
  const authorizationDetails = input.authorizationDetails ?? []
  assertAccessRequestAuthorizationDetails(resource, connection, authorizationDetails)
  if (connection && brokeredAccountConnection(resource)) {
    assertAuthorityConstraintScopes(input.scopes, connection, authorizationDetails)
  }
  await requireAgentResourceVisibility(deps, resource, identity.identity)
  const scopes = [...new Set(input.scopes)].sort()
  const now = new Date()
  const reusableEntitlements = (
    await deps.externalResources.listActiveEntitlementsByAgent(principal.identityId, now)
  ).filter(
    (entitlement) =>
      entitlement.connectionId === (connection?.id ?? null) &&
      entitlement.resourceServerId === resource.id &&
      exactAuthorizationDetails(entitlement.authorizationDetails, authorizationDetails),
  )
  const approvedEntitlements = scopes.flatMap((scope) => {
    const entitlement = reusableEntitlements.find((candidate) => candidate.scope === scope)
    return entitlement ? [{ scope, entitlementId: entitlement.id }] : []
  })
  const alreadyAuthorized = approvedEntitlements.length === scopes.length
  const binding = identity.bindings.find(
    (candidate) => candidate.hostId === principal.hostId && candidate.protocolAgentId === principal.protocolAgentId,
  )!
  const pending = (await deps.externalResources.listPendingAccessRequestsByAgent(principal.identityId, now)).find(
    (request) =>
      request.resourceId === resource.id &&
      request.connectionId === (connection?.id ?? null) &&
      exactScopes(request.scopes, scopes) &&
      exactAuthorizationDetails(request.authorizationDetails, authorizationDetails),
  )
  if (pending) {
    const token = await deps.secrets.open(pending.encryptedApprovalToken, accessRequestTokenContext(pending.id))
    return toAgentAccessRequest(pending, principal.hostId, approvalUrl(approvalOrigin, token))
  }
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  const rawApprovalToken = randomToken()
  const requestId = deps.ids.generate()
  const request: AgentAccessRequestRecord = {
    id: requestId,
    resourceId: resource.id,
    connectionId: connection?.id ?? null,
    agentIdentityId: principal.identityId,
    bindingId: binding.id,
    scopes,
    authorizationDetails,
    reason: input.reason ?? null,
    status: alreadyAuthorized ? 'approved' : 'pending',
    approvalTokenHash: await sha256(rawApprovalToken),
    encryptedApprovalToken: await deps.secrets.seal(rawApprovalToken, accessRequestTokenContext(requestId)),
    approvedEntitlements: alreadyAuthorized ? approvedEntitlements : [],
    expiresAt,
    decidedAt: alreadyAuthorized ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  const audit = await resourceAuditRecord(deps, {
    action: 'api_resource.access_requested',
    result: alreadyAuthorized ? 'allowed' : 'pending',
    principal,
    resourceId: resource.id,
    connection,
    accessRequestId: request.id,
    scopes,
    authorizationDetails,
    reasonCode: null,
  })
  const created = await deps.externalResources.createAccessRequestWithAudit(request, audit)
  if (!created) throw forbidden('Enabled Resource Server is required.')
  return toAgentAccessRequest(
    created,
    principal.hostId,
    alreadyAuthorized ? null : approvalUrl(approvalOrigin, rawApprovalToken),
  )
}

export async function createAccessRequest(
  deps: Deps,
  input: CreateAccessRequest,
  principal: AgentResourcePrincipal,
  approvalOrigin: string,
): Promise<AccessRequest> {
  const request = await createAgentAccessRequest(
    deps,
    {
      resourceId: input.resourceServerId,
      scopes: input.scopes,
      authorizationDetails: input.authorizationDetails,
      reason: input.reason,
    },
    principal,
    approvalOrigin,
  )
  return agentAccessRequestRepresentation(deps, request, approvalOrigin)
}

export async function getAgentAccessRequest(deps: Deps, requestId: string, principal: AgentResourcePrincipal) {
  await requireActiveIdentityAndBinding(deps, principal)
  const request = await deps.externalResources.findAccessRequest(requestId)
  if (!request || request.agentIdentityId !== principal.identityId)
    throw notFound('Agent access request was not found.')
  return toAgentAccessRequest(request, principal.hostId, null)
}

export async function getAccessRequest(
  deps: Deps,
  requestId: string,
  principal: AgentResourcePrincipal,
  apiOrigin: string,
): Promise<AccessRequest> {
  return agentAccessRequestRepresentation(deps, await getAgentAccessRequest(deps, requestId, principal), apiOrigin)
}

export async function listControllerAccessRequests(deps: Deps, actorUserId: string) {
  const now = new Date()
  const memberships = await deps.authorization.listUserMemberships(actorUserId)
  const [userConnections, organizationConnections] = await Promise.all([
    deps.externalResources.listConnectionsByUser(actorUserId),
    deps.externalResources.listConnectionsByOrganizations([
      ...new Set(memberships.map((membership) => membership.organizationId)),
    ]),
  ])
  const connections = [...userConnections, ...organizationConnections]
  const connectionIds = new Set(connections.map((connection) => connection.id))
  const requests = (await deps.externalResources.listPendingAccessRequests(now)).filter(
    (request) => request.connectionId === null || connectionIds.has(request.connectionId),
  )
  const controlledRequests = []
  for (const request of requests) {
    if (request.connectionId || (await controlsAgentIdentity(deps, request.agentIdentityId, actorUserId))) {
      controlledRequests.push(request)
    }
  }
  return {
    requests: await Promise.all(
      controlledRequests.map(async (request) =>
        toAgentAccessRequest(request, await requestHostId(deps, request), null),
      ),
    ),
  }
}

export async function listAccountAccessRequests(deps: Deps, actorUserId: string, pagination: PaginationInput) {
  const requests = (await listControllerAccessRequests(deps, actorUserId)).requests.map((request) =>
    toAccessRequest(request),
  )
  return {
    items: await Promise.all(
      requests
        .slice(pagination.offset, pagination.offset + pagination.limit)
        .map((request) => resolveAccessRequestApproval(deps, request)),
    ),
    pagination: paginationMetadata({ ...pagination, total: requests.length }),
  }
}

export async function getAccountAccessRequest(
  deps: Deps,
  requestId: string,
  actorUserId: string,
  approvalToken?: string,
): Promise<AccessRequest> {
  const request = approvalToken
    ? await getControllerAccessRequestByToken(deps, approvalToken, actorUserId)
    : await requireControlledAccessRequest(deps, requestId, actorUserId)
  if (request.id !== requestId) throw notFound('Agent access request was not found.')
  return toAccessRequest(request)
}

export async function getAccountAccessRequestByToken(
  deps: Deps,
  approvalToken: string,
  actorUserId: string,
): Promise<AccessRequestApproval> {
  const request = toAccessRequest(await getControllerAccessRequestByToken(deps, approvalToken, actorUserId))
  return resolveAccessRequestApproval(deps, request)
}

async function resolveAccessRequestApproval(deps: Deps, request: AccessRequest): Promise<AccessRequestApproval> {
  const record = await deps.externalResources.findAccessRequest(request.id)
  if (!record) throw notFound('Agent access request was not found.')
  const [identity, resource] = await Promise.all([
    deps.agentIdentities.findIdentity(request.agentId),
    deps.authorization.findResource(record.resourceId),
  ])
  if (!identity) throw notFound('Agent identity was not found.')
  if (!resource) throw notFound('API resource was not found.')
  const authorizationDetail = await resolveApprovalAuthorizationDetail(deps, resource, record)
  return {
    ...request,
    authorizationDetails: record.authorizationDetails,
    requiresAccountConnection: requiresAccountConnection(resource),
    agent: { id: identity.identity.id, name: identity.identity.name },
    resourceServer: { id: resource.id, name: resource.name },
    authorizationDetail: authorizationDetail
      ? { ...authorizationDetail, authorizationDetailTemplates: resource.authorizationDetails }
      : null,
  }
}

async function resolveApprovalAuthorizationDetail(
  deps: Deps,
  resourceServer: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  request: AgentAccessRequestRecord,
) {
  const detail = request.authorizationDetails[0]
  if (!detail) return null
  if (isRealmrootResourceServer(resourceServer.id)) {
    const display = await realmrootAuthorityDisplay(deps, detail)
    return {
      name: display.label,
      description: display.description,
      metadata: display.metadata,
    }
  }
  if (!request.connectionId) throw notFound('Resource account connection was not found.')
  const connection = await deps.externalResources.findConnection(request.connectionId)
  if (!connection || connection.status !== 'active') throw notFound('Active resource account connection was not found.')
  for (let offset = 0; ; ) {
    const catalog = await readResourceCatalog(deps, resourceServer, connection, request.agentIdentityId, {
      limit: 100,
      offset,
    })
    const match = catalog.items.find((item) => exactAuthorizationDetails([item.authorizationDetail], [detail]))
    if (match) {
      return {
        name: match.display.label,
        description: match.display.description ?? null,
        metadata: match.display.metadata ?? {},
      }
    }
    if (!catalog.pagination.hasMore || catalog.pagination.nextOffset === null) break
    offset = catalog.pagination.nextOffset
  }
  throw notFound('Authorization detail was not found.')
}

export async function getControllerAccessRequestByToken(deps: Deps, token: string, actorUserId: string) {
  const request = await requirePendingAccessRequestByToken(deps, token)
  await requireControlledRequestTarget(deps, request, actorUserId)
  return toAgentAccessRequest(request, await requestHostId(deps, request), null)
}

export async function decideAgentAccessRequestByToken(
  deps: Deps,
  token: string,
  input: DecideAgentAccessRequest,
  actorUserId: string,
) {
  const request = await requirePendingAccessRequestByToken(deps, token)
  return decideAgentAccessRequest(deps, request.id, input, actorUserId)
}

export async function decideAgentAccessRequest(
  deps: Deps,
  requestId: string,
  input: DecideAgentAccessRequest,
  actorUserId: string,
) {
  const request = await deps.externalResources.findAccessRequest(requestId)
  if (!request || request.status !== 'pending' || request.expiresAt.getTime() <= Date.now()) {
    throw notFound('Pending Agent access request was not found.')
  }
  const controlledConnection = await requireControlledRequestTarget(deps, request, actorUserId)
  const now = new Date()
  if (input.decision === 'deny') {
    const audit = await resourceAuditRecord(deps, {
      action: 'api_resource.access_decided',
      result: 'denied',
      resourceId: request.resourceId,
      connection: controlledConnection,
      request,
      accessRequestId: request.id,
      controllerUserId: actorUserId,
      scopes: request.scopes,
      authorizationDetails: request.authorizationDetails,
      reasonCode: 'controller_denied',
    })
    const decided = await deps.externalResources.decideAccessRequestWithAudit(
      request.id,
      { status: 'denied', approvedEntitlements: [], decidedAt: now, updatedAt: now },
      audit,
    )
    if (!decided) throw badRequest('Agent access request was already decided.')
    return toAgentAccessRequest(decided, await requestHostId(deps, request), null)
  }

  const resource = await requireEnabledResource(deps, request.resourceId)
  const authorizationDetails = input.authorizationDetails ?? []
  if (!authorizationDetailsMatchRequest(authorizationDetails, request.authorizationDetails)) {
    throw invalidAuthorizationDetails('Approved authorization details do not match the pending access request.')
  }
  validateResourceRequestedScopes(resource, request.scopes)
  const requestIdentity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
  if (!requestIdentity) throw notFound('Active Agent identity was not found.')
  await requireAgentResourceVisibility(deps, resource, requestIdentity.identity)
  const grantorScopes = isRealmrootResourceServer(resource.id)
    ? await realmrootAuthorityEffectiveScopes(deps, actorUserId, resource, authorizationDetails[0]!)
    : await userEffectiveResourceScopes(deps, actorUserId, resource)
  assertScopeSubset(request.scopes, grantorScopes, 'controller effective scope')
  const connectionId = request.connectionId
  let connection: ProviderResourceAuthorizationRecord | null = null
  if (requiresAccountConnection(resource)) {
    if (!connectionId) throw badRequest('An account connection is required to approve external API access.')
    connection = await requireControlledConnection(deps, connectionId, actorUserId)
    if (connection.resourceId !== resource.id || connection.status !== 'active') {
      throw badRequest('The selected account connection does not belong to this API resource.')
    }
    assertConnectionInHomeSpace(
      connection,
      requestIdentity.identity.ownerUserId,
      requestIdentity.identity.ownerOrganizationId,
    )
    assertScopeSubset(request.scopes, connection.grantedScopes, 'connected account')
    assertAuthorizationDetailsSelection(resource, connection, authorizationDetails)
    assertAuthorizationDetailsSubset(authorizationDetails, connection.authorizationDetails, 'connected account')
    if (brokeredAccountConnection(resource)) {
      assertAuthorityConstraintScopes(request.scopes, connection, authorizationDetails)
    }
  } else if (connectionId) {
    throw badRequest('Native API resources do not use account connections.')
  } else {
    assertAuthorizationDetailsSelection(resource, null, authorizationDetails)
  }
  const expiresAt = input.mode === 'until' ? new Date(input.expiresAt!) : null
  if (expiresAt && expiresAt.getTime() <= now.getTime()) throw badRequest('Permission expiry must be in the future.')
  const contextHash = await sha256(canonicalJson(authorizationDetails))
  const existing = (await deps.externalResources.listActiveEntitlementsByAgent(request.agentIdentityId, now)).filter(
    (entitlement) =>
      entitlement.resourceServerId === request.resourceId &&
      entitlement.connectionId === connectionId &&
      exactAuthorizationDetails(entitlement.authorizationDetails, authorizationDetails),
  )
  const entitlements: ResourceScopeEntitlementRecord[] = []
  const entitlementUpdates: Array<{
    id: string
    mode: ResourceScopeEntitlementRecord['mode']
    expiresAt: Date | null
    authorizationContextHash: string
    updatedAt: Date
  }> = []
  const approvedEntitlements = request.scopes.map((scope) => {
    const current = existing.find((entitlement) => entitlement.scope === scope)
    if (current) {
      const shouldPersist = input.mode === 'persistent' && current.mode !== 'persistent'
      const shouldExtend =
        input.mode === 'until' &&
        current.mode !== 'persistent' &&
        (!current.expiresAt || current.expiresAt.getTime() < expiresAt!.getTime())
      if (shouldPersist || shouldExtend || current.authorizationContextHash !== contextHash) {
        entitlementUpdates.push({
          id: current.id,
          mode: shouldPersist ? 'persistent' : shouldExtend ? 'until' : current.mode,
          expiresAt: shouldPersist ? null : shouldExtend ? expiresAt : current.expiresAt,
          authorizationContextHash: contextHash,
          updatedAt: now,
        })
      }
      return { scope, entitlementId: current.id }
    }
    const entitlement: ResourceScopeEntitlementRecord = {
      id: deps.ids.generate(),
      userId: null,
      applicationId: null,
      agentIdentityId: request.agentIdentityId,
      organizationId: null,
      resourceServerId: request.resourceId,
      connectionId,
      authorizationDetails,
      authorizationContextHash: contextHash,
      scope,
      mode: input.mode!,
      grantedByUserId: actorUserId,
      grantedByAgentIdentityId: null,
      sourceAccessRequestId: request.id,
      expiresAt,
      endedAt: null,
      endReason: null,
      createdAt: now,
      updatedAt: now,
    }
    entitlements.push(entitlement)
    return { scope, entitlementId: entitlement.id }
  })
  const audit = await resourceAuditRecord(deps, {
    action: 'api_resource.access_decided',
    result: 'allowed',
    resourceId: request.resourceId,
    connection,
    request,
    accessRequestId: request.id,
    controllerUserId: actorUserId,
    scopes: request.scopes,
    authorizationDetails,
    reasonCode: null,
  })
  const approved = await deps.externalResources.approveAccessRequestWithEntitlements(
    entitlements,
    entitlementUpdates,
    request.id,
    {
      status: 'approved',
      approvedEntitlements,
      connectionId,
      decidedAt: now,
      updatedAt: now,
    },
    audit,
    brokeredAccountConnection(resource) ? (connection?.providerEventRevision ?? null) : undefined,
  )
  if (approved === 'resource_unavailable') {
    throw badRequest('The API resource was deleted before access could be approved.')
  }
  if (approved === 'request_changed') throw badRequest('Agent access request was already decided.')
  return toAgentAccessRequest(approved.request, await requestHostId(deps, request), null)
}

export async function decideAccessRequest(
  deps: Deps,
  requestId: string,
  input: DecideAgentAccessRequest & { approvalToken?: string },
  actorUserId: string,
): Promise<AccessRequest> {
  if (input.approvalToken) {
    const request = await getControllerAccessRequestByToken(deps, input.approvalToken, actorUserId)
    if (request.id !== requestId) throw notFound('Agent access request was not found.')
  }
  return toAccessRequest(await decideAgentAccessRequest(deps, requestId, input, actorUserId))
}

export async function issueTargetAccessToken(
  deps: Deps,
  requestId: string,
  dpopProof: string,
  tokenRequestUrl: string,
  principal: AgentResourcePrincipal,
  signer: AgentAssertionSigner,
) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const request = await deps.externalResources.findAccessRequest(requestId)
  if (
    !request ||
    request.agentIdentityId !== principal.identityId ||
    (request.status !== 'approved' && request.status !== 'consumed')
  ) {
    throw forbidden('Approved Agent access request is required.')
  }
  const entitlementIds = request.approvedEntitlements.map((snapshot) => snapshot.entitlementId)
  const entitlements = await deps.externalResources.findEntitlements(entitlementIds)
  const now = new Date()
  if (
    entitlements.length !== request.scopes.length ||
    request.approvedEntitlements.length !== request.scopes.length ||
    request.approvedEntitlements.some(({ scope, entitlementId }) => {
      const entitlement = entitlements.find((candidate) => candidate.id === entitlementId)
      return (
        !entitlement ||
        entitlement.scope !== scope ||
        entitlement.agentIdentityId !== principal.identityId ||
        entitlement.resourceServerId !== request.resourceId ||
        entitlement.connectionId !== request.connectionId ||
        entitlement.endedAt !== null ||
        (entitlement.expiresAt !== null && entitlement.expiresAt.getTime() <= now.getTime()) ||
        !exactAuthorizationDetails(entitlement.authorizationDetails, request.authorizationDetails)
      )
    })
  ) {
    throw forbidden('Every approved scope requires an active Entitlement.')
  }
  const resource = await deps.authorization.findResource(request.resourceId)
  if (!resource?.enabled) throw forbidden('Enabled Resource Server is required.')
  validateResourceRequestedScopes(resource, request.scopes)
  if (!activeResourceVisibleToAgent(resource, await activeIdentityOrganizationIds(deps, identity.identity))) {
    throw forbidden('Resource Server is not visible to this Agent.')
  }
  if (resource.accessMode !== 'external_oauth') {
    const connection = request.connectionId ? await deps.externalResources.findConnection(request.connectionId) : null
    assertAuthorizationDetailsSelection(resource, connection, request.authorizationDetails)
    return issueNativeAccessToken(
      deps,
      { entitlements, request, resource, identity },
      dpopProof,
      tokenRequestUrl,
      principal,
      signer,
    )
  }

  const connection = request.connectionId ? await deps.externalResources.findConnection(request.connectionId) : null
  if (!connection || connection.status !== 'active') {
    throw forbidden('Active external API resource grant is required.')
  }
  const connectionClientGeneration = connection.clientGeneration ?? 1
  const connectorId = resource.connectorId!
  const connector = await deps.connectors.findById(connectorId)
  if ((connector?.clientGeneration ?? 1) === connectionClientGeneration) {
    const activeClientGeneration = await ensureDynamicConnectorScopes(
      deps,
      connectorId,
      connection.grantedScopes,
      new URL(tokenRequestUrl).origin,
    )
    if (activeClientGeneration !== connectionClientGeneration) {
      throw forbidden('The connected account must be reauthorized after OAuth client rotation.')
    }
  }
  const authorization = await findExternalAuthorization(deps, request.resourceId, connectionClientGeneration)
  if (authorization?.status !== 'active') {
    throw forbidden('Active external API resource grant is required.')
  }
  assertScopeSubset(request.scopes, connection.grantedScopes, 'connected account')
  assertAuthorizationDetailsSelection(resource, connection, request.authorizationDetails)
  assertAuthorizationDetailsSubset(request.authorizationDetails, connection.authorizationDetails, 'connected account')
  const confirmationJkt = await validateDpopTokenProof(deps, dpopProof, authorization.tokenEndpoint)
  const subjectToken = (await refreshConnectionToken(deps, connection, authorization)).accessToken
  const nowSeconds = Math.floor(Date.now() / 1000)
  const agentAssertion = await signer.sign(
    {
      iss: principal.issuer,
      sub: principal.subject,
      aud: authorization.tokenEndpoint,
      iat: nowSeconds,
      exp: nowSeconds + 300,
      jti: crypto.randomUUID(),
    },
    'JWT',
  )
  const clientSecret = authorizationClientSecret(authorization)
  const actorGrant = await postForm(
    deps,
    authorization.tokenEndpoint,
    {
      grant_type: jwtBearerGrantType,
      assertion: agentAssertion,
    },
    authorization.clientId,
    clientSecret,
  )
  const actorToken = requiredString(actorGrant, 'access_token', 'RFC 7523 JWT bearer grant response')
  const tokenResponse = await postFormResponse(
    deps,
    authorization.tokenEndpoint,
    {
      grant_type: tokenExchangeGrantType,
      subject_token: subjectToken,
      subject_token_type: accessTokenType,
      actor_token: actorToken,
      actor_token_type: accessTokenType,
      requested_token_type: accessTokenType,
      resource: resource.resourceUrl,
      scope: request.scopes.join(' '),
      ...(request.authorizationDetails.length > 0
        ? { authorization_details: JSON.stringify(request.authorizationDetails) }
        : {}),
    },
    authorization.clientId,
    clientSecret,
    new Headers({ dpop: dpopProof }),
  )
  const token = tokenResponse.body
  const accessToken = requiredString(token, 'access_token', 'Token exchange response')
  if (String(token.token_type).toLowerCase() !== 'dpop') {
    throw unauthorized('Target authorization server did not issue a DPoP-bound access token.')
  }
  const expiresIn = requiredPositiveInteger(token, 'expires_in', 'Token exchange response')
  const expiresAt = new Date(now.getTime() + expiresIn * 1000)
  if (expiresIn > 3600) {
    throw unauthorized('Target authorization server issued an access token with an excessive lifetime.')
  }
  const entitlementExpiry = earliestEntitlementExpiry(entitlements)
  if (entitlementExpiry && expiresAt.getTime() > entitlementExpiry.getTime()) {
    throw unauthorized('Target authorization server issued an access token beyond an Entitlement lifetime.')
  }
  const issuedScope = scopeString(token.scope) ?? request.scopes
  if (!exactScopes(issuedScope, request.scopes)) {
    throw unauthorized('Target authorization server issued a different scope set.')
  }
  const issuedAuthorizationDetails = readAuthorizationDetails(
    token.authorization_details,
    request.authorizationDetails.length > 0,
    request.authorizationDetails.map((detail) => detail.type),
    'Token exchange response',
  )
  if (!exactAuthorizationDetails(issuedAuthorizationDetails, request.authorizationDetails)) {
    throw unauthorized('Target authorization server issued different authorization details.')
  }
  const leaseId = deps.ids.generate()
  const leaseRecord = {
    id: leaseId,
    entitlementIds,
    requestId: request.id,
    bindingId: identity.bindings.find(
      (binding) => binding.protocolAgentId === principal.protocolAgentId && binding.hostId === principal.hostId,
    )!.id,
    encryptedAccessToken: await deps.secrets.seal(accessToken, tokenLeaseContext(leaseId)),
    tokenHash: await sha256(accessToken),
    confirmationJkt,
    scopes: request.scopes,
    authorizationDetails: request.authorizationDetails,
    expiresAt,
    revokedAt: null,
    createdAt: now,
  }
  const audit = await resourceAuditRecord(deps, {
    action: 'api_resource.token_issued',
    result: 'allowed',
    principal,
    resourceId: resource.id,
    connection,
    request,
    accessRequestId: request.id,
    scopes: request.scopes,
    authorizationDetails: request.authorizationDetails,
    reasonCode: null,
  })
  const lease = await deps.externalResources.issueTokenLeaseWithAudit(
    leaseRecord,
    entitlements.filter((entitlement) => entitlement.mode === 'once').map((entitlement) => entitlement.id),
    now,
    audit,
  )
  if (!lease) throw forbidden('Every approved scope requires an active Entitlement.')
  return {
    accessToken,
    tokenType: 'DPoP' as const,
    expiresIn,
    expiresAt: expiresAt.toISOString(),
    scopes: request.scopes,
    authorizationDetails: request.authorizationDetails,
    resourceUrl: resource.resourceUrl,
    dpopNonce: tokenResponse.dpopNonce,
  }
}

export async function createAccessRequestCredential(
  deps: Deps,
  requestId: string,
  dpopProof: string,
  credentialRequestUrl: string,
  principal: AgentResourcePrincipal,
  signer: AgentAssertionSigner,
) {
  const request = await getAgentAccessRequest(deps, requestId, principal)
  if (
    (request.status !== 'approved' && request.status !== 'consumed') ||
    request.approvedEntitlements.length !== request.scopes.length
  ) {
    throw forbidden('Approved Resource access is required.')
  }
  const token = await issueTargetAccessToken(deps, request.id, dpopProof, credentialRequestUrl, principal, signer)
  return {
    ...token,
    resourceIndicator: token.resourceUrl,
  }
}

async function issueNativeAccessToken(
  deps: Deps,
  context: {
    entitlements: ResourceScopeEntitlementRecord[]
    request: AgentAccessRequestRecord
    resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>
    identity: Awaited<ReturnType<typeof requireActiveIdentityAndBinding>>
  },
  dpopProof: string,
  tokenRequestUrl: string,
  principal: AgentResourcePrincipal,
  signer: AgentAssertionSigner,
) {
  const { entitlements, request, resource, identity } = context
  const brokered = brokeredAccountConnection(resource)
  const connectorBackedNative = resource.accessMode === 'realmroot' && resource.connectorId !== null
  if (request.connectionId !== null && !brokered && !connectorBackedNative) {
    throw forbidden('Native API resource grants cannot use account connections.')
  }
  const connection =
    brokered || connectorBackedNative
      ? request.connectionId
        ? await deps.externalResources.findConnection(request.connectionId)
        : null
      : null
  if (
    brokered &&
    (!connection ||
      connection.status !== 'active' ||
      connection.resourceId !== resource.id ||
      connection.credentialCustody !== 'resource_server' ||
      !connection.brokerReference)
  ) {
    throw forbidden('Active brokered account connection is required.')
  }
  if (
    connectorBackedNative &&
    (!connection ||
      connection.status !== 'active' ||
      connection.resourceId !== resource.id ||
      connection.credentialCustody !== 'realmroot' ||
      !connection.encryptedTokens)
  ) {
    throw forbidden('Active provider account connection is required.')
  }
  if (brokered) {
    assertScopeSubset(request.scopes, connection!.grantedScopes, 'connected account')
    assertAuthorizationDetailsSubset(
      request.authorizationDetails,
      connection!.authorizationDetails,
      'connected account',
    )
    assertAuthorityConstraintScopes(request.scopes, connection!, request.authorizationDetails)
  }
  if (connectorBackedNative) {
    assertScopeSubset(request.scopes, connection!.grantedScopes, 'connected account')
  }
  if (signer.issuer !== principal.issuer) {
    throw forbidden('Agent identity does not belong to the active OAuth issuer.')
  }
  const confirmationJkt = await validateDpopTokenProof(deps, dpopProof, tokenRequestUrl)
  const now = new Date()
  const maximumExpiresAt = new Date(now.getTime() + 5 * 60 * 1000)
  const entitlementExpiry = earliestEntitlementExpiry(entitlements)
  const expiresAt =
    entitlementExpiry && entitlementExpiry.getTime() < maximumExpiresAt.getTime() ? entitlementExpiry : maximumExpiresAt
  const subject = identity.identity.ownerUserId ?? identity.identity.ownerOrganizationId
  if (!subject) throw forbidden('Agent home-space controller is unavailable.')
  const realmroot = isRealmrootResourceServer(resource.id)
  const realmrootAuthority = realmroot ? request.authorizationDetails[0] : undefined
  if (realmroot) assertRealmrootAuthoritySelection(request.authorizationDetails)
  const issuedScopes = realmroot ? [...new Set([...agentBootstrapScopes, ...request.scopes])].sort() : request.scopes
  const accessToken = await signer.sign(
    {
      iss: signer.issuer,
      sub: realmroot ? principal.subject : subject,
      aud: resource.resourceUrl,
      jti: createProtocolId('resat'),
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      scope: issuedScopes.join(' '),
      groups:
        realmrootAuthority?.authority === 'organization' && typeof realmrootAuthority.id === 'string'
          ? [realmrootAuthority.id]
          : identity.identity.ownerOrganizationId
            ? [identity.identity.ownerOrganizationId]
            : [],
      client_id: principal.protocolAgentId,
      ...(connection
        ? {
            connection_id: brokered ? connection.brokerReference : connection.id,
            authorization_details: request.authorizationDetails,
          }
        : {}),
      ...(realmroot
        ? { host_id: principal.hostId, sub_profile: 'ai_agent', realmroot_authority: realmrootAuthority }
        : {}),
      cnf: { jkt: confirmationJkt },
      act: {
        iss: principal.issuer,
        sub: principal.subject,
        sub_profile: 'ai_agent',
      },
    },
    'at+jwt',
  )
  const leaseId = deps.ids.generate()
  const leaseRecord = {
    id: leaseId,
    entitlementIds: entitlements.map((entitlement) => entitlement.id),
    requestId: request.id,
    bindingId: identity.bindings.find(
      (binding) => binding.protocolAgentId === principal.protocolAgentId && binding.hostId === principal.hostId,
    )!.id,
    encryptedAccessToken: await deps.secrets.seal(accessToken, tokenLeaseContext(leaseId)),
    tokenHash: await sha256(accessToken),
    confirmationJkt,
    scopes: request.scopes,
    authorizationDetails: realmroot || brokered ? request.authorizationDetails : [],
    expiresAt,
    revokedAt: null,
    createdAt: now,
  }
  const audit = await resourceAuditRecord(deps, {
    action: 'api_resource.token_issued',
    result: 'allowed',
    principal,
    resourceId: resource.id,
    connection,
    request,
    accessRequestId: request.id,
    scopes: request.scopes,
    authorizationDetails: realmroot || brokered ? request.authorizationDetails : [],
    reasonCode: null,
  })
  const lease = await deps.externalResources.issueTokenLeaseWithAudit(
    leaseRecord,
    entitlements.filter((entitlement) => entitlement.mode === 'once').map((entitlement) => entitlement.id),
    now,
    audit,
  )
  if (!lease) throw forbidden('Every approved scope requires an active Entitlement.')
  return {
    accessToken,
    tokenType: 'DPoP' as const,
    expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    expiresAt: expiresAt.toISOString(),
    scopes: request.scopes,
    authorizationDetails: realmroot || brokered ? request.authorizationDetails : [],
    resourceUrl: resource.resourceUrl,
    dpopNonce: null,
  }
}

export async function exchangeAgentConnectionCredential(
  deps: Deps,
  input: {
    subjectToken: string
    claims: Record<string, unknown>
    audience: string
    scopes: string[]
  },
) {
  const now = new Date()
  const lease = await deps.externalResources.findActiveTokenLeaseByTokenHash(await sha256(input.subjectToken), now)
  if (!lease) throw oauthError('invalid_grant', 'Agent access token lease is not active.')
  const storedToken = await deps.secrets.open(lease.encryptedAccessToken, tokenLeaseContext(lease.id))
  if (storedToken !== input.subjectToken) throw oauthError('invalid_grant', 'Agent access token lease is invalid.')

  const request = await deps.externalResources.findAccessRequest(lease.requestId)
  if (
    !request ||
    (request.status !== 'approved' && request.status !== 'consumed') ||
    request.bindingId !== lease.bindingId ||
    !request.connectionId ||
    !exactScopes(request.scopes, lease.scopes)
  ) {
    throw oauthError('invalid_grant', 'Agent access request is no longer valid.')
  }
  const [identity, connection, resource, entitlements] = await Promise.all([
    deps.agentIdentities.findIdentity(request.agentIdentityId),
    deps.externalResources.findConnection(request.connectionId),
    deps.authorization.findResource(request.resourceId),
    deps.externalResources.findEntitlements(lease.entitlementIds),
  ])
  const binding = identity?.bindings.find(
    (candidate) => candidate.id === request.bindingId && candidate.status === 'active',
  )
  if (!identity || identity.identity.status !== 'active' || !binding) {
    throw oauthError('invalid_grant', 'Agent identity or host binding is no longer active.')
  }
  if (
    !resource?.enabled ||
    resource.accessMode !== 'realmroot' ||
    !resource.connectorId ||
    resource.resourceUrl !== input.audience
  ) {
    throw oauthError('invalid_target', 'Agent token audience is not a connector-backed native Resource Server.')
  }
  if (
    !connection ||
    connection.status !== 'active' ||
    connection.id !== request.connectionId ||
    connection.resourceId !== resource.id ||
    connection.credentialCustody !== 'realmroot' ||
    !connection.encryptedTokens
  ) {
    throw oauthError('invalid_grant', 'Provider account connection is no longer active.')
  }
  if (
    connection.ownerUserId !== identity.identity.ownerUserId ||
    connection.ownerOrganizationId !== identity.identity.ownerOrganizationId
  ) {
    throw oauthError('invalid_grant', 'Provider account connection is outside the Agent home space.')
  }
  if (
    entitlements.length !== lease.entitlementIds.length ||
    entitlements.some(
      (entitlement) =>
        entitlement.agentIdentityId !== identity.identity.id ||
        entitlement.resourceServerId !== resource.id ||
        entitlement.connectionId !== connection.id ||
        entitlement.endedAt !== null ||
        (entitlement.expiresAt !== null && entitlement.expiresAt.getTime() <= now.getTime()) ||
        !lease.scopes.includes(entitlement.scope),
    )
  ) {
    throw oauthError('invalid_grant', 'Agent Permissions are no longer active.')
  }

  const act = recordValue(input.claims.act)
  const confirmation = recordValue(input.claims.cnf)
  const subject = identity.identity.ownerUserId ?? identity.identity.ownerOrganizationId
  const tokenScopes = scopeString(input.claims.scope) ?? []
  if (
    input.claims.aud !== resource.resourceUrl ||
    input.claims.sub !== subject ||
    input.claims.client_id !== binding.protocolAgentId ||
    input.claims.connection_id !== connection.id ||
    act?.iss !== identity.identity.issuer ||
    act?.sub !== identity.identity.subject ||
    act?.sub_profile !== 'ai_agent' ||
    confirmation?.jkt !== lease.confirmationJkt ||
    !exactScopes(tokenScopes, lease.scopes)
  ) {
    throw oauthError('invalid_grant', 'Agent access token claims do not match its active authority.')
  }
  assertOAuthScopeSubset(input.scopes, tokenScopes, 'Agent access token')
  assertOAuthScopeSubset(input.scopes, connection.grantedScopes, 'connected provider account')

  const authorization = await requireActiveConnectorAuthorization(deps, resource.id, connection.clientGeneration ?? 1)
  const credential = await refreshConnectionToken(deps, connection, authorization)
  if (!credential.expiresAt) {
    throw oauthError('temporarily_unavailable', 'Provider access token does not expose a usable expiry.', 503)
  }
  return {
    accessToken: credential.accessToken,
    expiresIn: Math.max(1, Math.floor((credential.expiresAt.getTime() - Date.now()) / 1000)),
    scopes: credential.scopes,
  }
}

export async function listAgentPermissions(
  deps: Deps,
  principal: AgentResourcePrincipal,
  query: ListAgentPermissionsQuery,
) {
  await requireActiveIdentityAndBinding(deps, principal)
  const result = await deps.externalResources.listAgentPermissions({ ...query, agentId: principal.identityId })
  return {
    items: result.items.map(({ entitlement, resource }) => toPermission(entitlement, resource)),
    pagination: paginationMetadata(result),
  }
}

export async function getAgentPermission(
  deps: Deps,
  entitlementId: string,
  principal: AgentResourcePrincipal,
): Promise<AgentPermission> {
  await requireActiveIdentityAndBinding(deps, principal)
  const entitlement = await deps.externalResources.findEntitlement(entitlementId)
  if (!entitlement || entitlement.agentIdentityId !== principal.identityId) {
    throw notFound('Agent Permission was not found.')
  }
  const resource = await deps.authorization.findResource(entitlement.resourceServerId)
  if (!resource) throw notFound('Agent Permission Resource Server was not found.')
  return toPermission(entitlement, resource)
}

export async function revokeAgentPermission(deps: Deps, entitlementId: string, actorUserId: string) {
  const entitlement = await deps.externalResources.findEntitlement(entitlementId)
  if (!entitlement?.agentIdentityId || entitlement.endedAt) throw notFound('Agent Permission was not found.')
  const request = entitlement.sourceAccessRequestId
    ? await deps.externalResources.findAccessRequest(entitlement.sourceAccessRequestId)
    : null
  if (!request) throw notFound('Source Agent access request was not found.')
  const connection = await requireControlledRequestTarget(deps, request, actorUserId)
  const now = new Date()
  const leaseIds = await revokeEntitlementTokenLeasesAtTarget(deps, entitlement, now)
  const audit = await resourceAuditRecord(deps, {
    action: 'api_resource.access_revoked',
    result: 'allowed',
    request,
    resourceId: entitlement.resourceServerId,
    connection,
    accessRequestId: request.id,
    controllerUserId: actorUserId,
    scopes: [entitlement.scope],
    authorizationDetails: entitlement.authorizationDetails,
    reasonCode: null,
  })
  await deps.externalResources.endEntitlementWithAudit(entitlement.id, 'revoked', leaseIds, now, audit)
}

export async function revokeAgentResourceAccess(deps: Deps, agentIdentityId: string) {
  const now = new Date()
  for (const entitlement of await deps.externalResources.listActiveEntitlementsByAgent(agentIdentityId, now)) {
    await revokeEntitlementTokenLeases(deps, entitlement, now)
    await deps.externalResources.endEntitlement(entitlement.id, 'revoked', now)
  }
}

export async function revokeAgentResourceLeasesForBinding(deps: Deps, bindingId: string) {
  const now = new Date()
  for (const lease of await deps.externalResources.listActiveTokenLeasesByBinding(bindingId, now)) {
    await revokeTokenLeaseAtTarget(deps, lease, now)
  }
}

async function revokeEntitlementTokenLeases(deps: Deps, entitlement: ResourceScopeEntitlementRecord, now: Date) {
  for (const lease of await deps.externalResources.listActiveTokenLeasesByEntitlement(entitlement.id, now)) {
    await revokeTokenLeaseAtTarget(deps, lease, now)
  }
}

async function revokeEntitlementTokenLeasesAtTarget(
  deps: Deps,
  entitlement: ResourceScopeEntitlementRecord,
  now: Date,
) {
  const leases = await deps.externalResources.listActiveTokenLeasesByEntitlement(entitlement.id, now)
  for (const lease of leases) await revokeTokenLeaseAtTarget(deps, lease, now, false)
  return leases.map((lease) => lease.id)
}

async function revokeTokenLeaseAtTarget(
  deps: Deps,
  lease: Awaited<ReturnType<Deps['externalResources']['listActiveTokenLeasesByEntitlement']>>[number],
  now: Date,
  persist = true,
) {
  const request = await deps.externalResources.findAccessRequest(lease.requestId)
  if (!request) throw notFound('Approved Agent access request was not found.')
  const resource = await deps.authorization.findResource(request.resourceId)
  if (!resource) throw notFound('API resource was not found.')
  const connection = request.connectionId ? await deps.externalResources.findConnection(request.connectionId) : null
  const authorization = await externalOAuthAuthorization(deps, resource, connection?.clientGeneration ?? 1)
  if (!authorization) {
    if (persist) await deps.externalResources.revokeTokenLease(lease.id, now)
    return
  }
  if (!connection) throw notFound('Resource account connection was not found.')
  const clientSecret = authorizationClientSecret(authorization)
  const token = await deps.secrets.open(lease.encryptedAccessToken, tokenLeaseContext(lease.id))
  await postEmptyForm(
    deps,
    authorization.revocationEndpoint,
    { token, token_type_hint: 'access_token' },
    authorization.clientId,
    clientSecret,
  )
  if (persist) await deps.externalResources.revokeTokenLease(lease.id, now)
}

async function readAuthorizationDetailCatalog(
  deps: Deps,
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  connection: ProviderResourceAuthorizationRecord,
  agentIdentityId: string,
  pagination: PaginationInput,
) {
  const authorization = await requireActiveExternalAuthorization(deps, resource.id, connection.clientGeneration ?? 1)
  const endpoint = authorization.authorizationDetailsCatalogEndpoint
  const requiredScope = authorization.authorizationDetailsCatalogScope
  if (!endpoint || !requiredScope) {
    throw badRequest('External API resource does not advertise an authorization detail catalog.')
  }
  if (!connection.grantedScopes.includes(requiredScope)) {
    throw badRequest('Resource account must be reauthorized for the authorization detail catalog scope.')
  }
  const accessToken = (await refreshConnectionToken(deps, connection, authorization)).accessToken
  const catalogUrl = new URL(endpoint)
  catalogUrl.searchParams.set('limit', String(pagination.limit))
  catalogUrl.searchParams.set('offset', String(pagination.offset))
  let response: Response
  try {
    response = await deps.externalHttp.fetch(
      new Request(catalogUrl, {
        headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      }),
    )
  } catch {
    throw badGateway('Authorization detail catalog could not be reached.', { url: endpoint })
  }
  if (!response.ok) {
    throw badGateway('Authorization detail catalog request failed.', { url: endpoint, status: response.status })
  }
  const parsed = authorizationDetailCatalogSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw badGateway('Authorization detail catalog response is invalid.', { url: endpoint })
  if (parsed.data.pagination.limit !== pagination.limit || parsed.data.pagination.offset !== pagination.offset) {
    throw badGateway('Authorization detail catalog returned mismatched pagination metadata.', { url: endpoint })
  }
  if (parsed.data.items.length > pagination.limit) {
    throw badGateway('Authorization detail catalog returned more items than requested.', { url: endpoint })
  }
  if (
    parsed.data.pagination.hasMore !== (parsed.data.pagination.nextOffset !== null) ||
    (parsed.data.pagination.nextOffset !== null && parsed.data.pagination.nextOffset <= pagination.offset) ||
    parsed.data.pagination.total < pagination.offset + parsed.data.items.length
  ) {
    throw badGateway('Authorization detail catalog returned inconsistent pagination metadata.', { url: endpoint })
  }
  const catalogKeys = parsed.data.items.map((item) => canonicalJson(item.authorizationDetail))
  if (new Set(catalogKeys).size !== catalogKeys.length) {
    throw badGateway('Authorization detail catalog contains duplicate details.', { url: endpoint })
  }
  if (
    parsed.data.items.some(
      (item) =>
        !resource.authorizationDetails.some((template) =>
          authorizationDetailMatchesTemplate(item.authorizationDetail, template),
        ),
    )
  ) {
    throw badGateway('Authorization detail catalog contains a detail outside the resource templates.', {
      url: endpoint,
    })
  }
  const entitlements = (await deps.externalResources.listActiveEntitlementsByAgent(agentIdentityId, new Date())).filter(
    (entitlement) => entitlement.resourceServerId === resource.id && entitlement.connectionId === connection.id,
  )
  const items = parsed.data.items.map((item) => {
    const connectionAuthorized = connection.authorizationDetails.some((detail) =>
      exactAuthorizationDetails([detail], [item.authorizationDetail]),
    )
    const authorizedScopes = new Set(
      entitlements
        .filter((entitlement) =>
          entitlement.authorizationDetails.some((detail) =>
            exactAuthorizationDetails([detail], [item.authorizationDetail]),
          ),
        )
        .map((entitlement) => entitlement.scope),
    )
    return {
      ...item,
      connectionStatus: connectionAuthorized ? ('authorized' as const) : ('authorization_required' as const),
      authorizedScopes: connectionAuthorized ? [...authorizedScopes].sort() : [],
      requestableScopes: connectionAuthorized
        ? authorityConstraintScopes(connection, [item.authorizationDetail])
            .filter(
              (scope) =>
                scope !== 'openid' &&
                scope !== 'offline_access' &&
                scope !== requiredScope &&
                !authorizedScopes.has(scope),
            )
            .sort()
        : [],
    }
  })
  return {
    items,
    pagination: parsed.data.pagination,
    connection: { status: 'connected' as const },
  }
}

async function readResourceCatalog(
  deps: Deps,
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  connection: ProviderResourceAuthorizationRecord,
  agentIdentityId: string,
  pagination: PaginationInput,
) {
  const authorization = await externalOAuthAuthorization(deps, resource, connection.clientGeneration ?? 1)
  if (authorization?.authorizationDetailsCatalogEndpoint && authorization.authorizationDetailsCatalogScope) {
    return readAuthorizationDetailCatalog(deps, resource, connection, agentIdentityId, pagination)
  }
  const details = connection.authorizationDetails.slice(pagination.offset, pagination.offset + pagination.limit)
  const entitlements = (await deps.externalResources.listActiveEntitlementsByAgent(agentIdentityId, new Date())).filter(
    (entitlement) => entitlement.resourceServerId === resource.id && entitlement.connectionId === connection.id,
  )
  return {
    items: details.map((authorizationDetail) => {
      const authorizedScopes = [
        ...new Set(
          entitlements
            .filter((entitlement) =>
              entitlement.authorizationDetails.some((detail) =>
                exactAuthorizationDetails([detail], [authorizationDetail]),
              ),
            )
            .map((entitlement) => entitlement.scope),
        ),
      ].sort()
      return {
        authorizationDetail,
        display: authorizationDetailDisplay(authorizationDetail),
        connectionStatus: 'authorized' as const,
        authorizedScopes,
        requestableScopes: authorityConstraintScopes(connection, [authorizationDetail])
          .filter((scope) => scope !== 'openid' && scope !== 'offline_access' && !authorizedScopes.includes(scope))
          .sort(),
      }
    }),
    pagination: paginationMetadata({ ...pagination, total: connection.authorizationDetails.length }),
    connection: { status: 'connected' as const },
  }
}

async function activeResourceScopes(
  deps: Deps,
  agentIdentityId: string,
  resourceServerId: string,
  authorizationDetails: AuthorizationDetail[],
) {
  return [
    ...new Set(
      (await deps.externalResources.listActiveEntitlementsByAgent(agentIdentityId, new Date()))
        .filter(
          (entitlement) =>
            entitlement.resourceServerId === resourceServerId &&
            exactAuthorizationDetails(entitlement.authorizationDetails, authorizationDetails),
        )
        .map((entitlement) => entitlement.scope),
    ),
  ].sort()
}

async function realmrootAuthorityDetailsCatalog(
  deps: Deps,
  identity: Awaited<ReturnType<typeof requireActiveIdentityAndBinding>>,
  agentIdentityId: string,
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
) {
  const details = await realmrootAuthorityDetails(deps, identity)
  return Promise.all(
    details.map(async (detail) => {
      const display = await realmrootAuthorityDisplay(deps, detail)
      const requestableScopes = await realmrootAuthorityEffectiveScopes(
        deps,
        identity.identity.ownerUserId,
        resource,
        detail,
      )
      return toResourceServerAuthorizationDetail({
        authorizationDetail: detail,
        display,
        connectionStatus: 'not_required',
        authorizedScopes: await activeResourceScopes(deps, agentIdentityId, resource.id, [detail]),
        requestableScopes,
      })
    }),
  )
}

async function realmrootAuthorityDetails(
  deps: Deps,
  identity: Awaited<ReturnType<typeof requireActiveIdentityAndBinding>>,
): Promise<AuthorizationDetail[]> {
  const details: AuthorizationDetail[] = []
  const ownerUserId = identity.identity.ownerUserId
  if (ownerUserId) {
    details.push({ type: 'realmroot_authority', authority: 'user', id: ownerUserId })
  }
  for (const organizationId of [...(await activeIdentityOrganizationIds(deps, identity.identity))].sort()) {
    details.push({
      type: 'realmroot_authority',
      authority: 'organization',
      id: organizationId,
    })
  }
  return details
}

async function realmrootAuthorityDisplay(
  deps: Deps,
  detail: AuthorizationDetail,
): Promise<{ label: string; description: string | null; metadata: Record<string, string> }> {
  const authority = detail.authority
  const id = detail.id
  if (authority === 'organization' && typeof id === 'string') {
    const organization = await deps.authorization.findOrganization(id)
    if (!organization) throw notFound('Organization authority was not found.')
    return {
      label: organization.displayName ?? organization.name,
      description: 'Organization-scoped administration authority.',
      metadata: { authority: 'organization', organizationId: id },
    }
  }
  if (authority === 'user' && typeof id === 'string') {
    const user = await deps.users.getUser(id)
    return {
      label: user.displayName || user.email,
      description: 'User-tenant administration authority.',
      metadata: { authority: 'user', userId: id },
    }
  }
  throw badRequest('Realmroot authority Resource is invalid.')
}

async function realmrootAuthorityEffectiveScopes(
  deps: Deps,
  controllerUserId: string | null,
  resource: ApiResourceResponse,
  detail: AuthorizationDetail,
) {
  const declared = new Set(discoverAgentResourceScopes(resource)?.map((scope) => scope.value) ?? [])
  const current = (scopes: Iterable<string>) => [...new Set(scopes)].filter((scope) => declared.has(scope)).sort()

  if (detail.authority === 'organization' && typeof detail.id === 'string') {
    if (!controllerUserId) return current(realmrootManagementScopes)
    const membership = (await deps.authorization.listUserMemberships(controllerUserId)).find(
      (item) => item.organizationId === detail.id,
    )
    return membership
      ? current(await resolveOrganizationMembershipScopes(deps, detail.id, membership.roles, resource.id))
      : []
  }
  if (controllerUserId && detail.authority === 'user' && detail.id === controllerUserId) {
    const scopes = new Set(['agents:read', 'agents:write', 'audit-events:read'])
    for (const entitlement of await deps.authorization.listActiveUserScopeEntitlements(
      controllerUserId,
      resource.id,
      new Date(),
    )) {
      scopes.add(entitlement.scope)
    }
    return current(scopes)
  }
  return []
}

function toResourceServerAuthorizationDetail(input: {
  authorizationDetail: AuthorizationDetail
  display: {
    label: string
    description?: string | null
    metadata?: Record<string, string>
  }
  connectionStatus: 'authorized' | 'authorization_required' | 'not_required'
  authorizedScopes: string[]
  requestableScopes: string[]
}) {
  return {
    authorizationDetail: input.authorizationDetail,
    name: input.display.label,
    description: input.display.description ?? null,
    metadata: input.display.metadata ?? {},
    accountAuthorizationStatus: input.connectionStatus,
    authorizedScopes: input.authorizedScopes,
    requestableScopes: input.requestableScopes.filter((scope) => !input.authorizedScopes.includes(scope)),
  }
}

function toResourceServer(
  resource: Awaited<ReturnType<typeof getApiResourceConfiguration>>,
  origin: string,
  connection: {
    status: 'connected' | 'not_connected' | 'not_required'
    displayName: string | null
    authorizedScopes: string[]
  } | null,
) {
  const self = `${origin}/api/resource-servers/${encodeURIComponent(resource.id)}`
  return {
    ...resource,
    availability: {
      status:
        resource.scopeRegistry && resource.scopeRegistry.discovery.lastError === null
          ? ('available' as const)
          : ('unavailable' as const),
      checkedAt: resource.scopeRegistry?.discovery.syncedAt ?? resource.updatedAt,
    },
    scopes: resource.scopeRegistry?.scopes.map(({ value, description }) => ({ value, description })) ?? [],
    connection,
    links: {
      self,
      authorizationDetails: `${self}/authorization-details`,
      connectionRequests: requiresAccountConnection(resource) ? `${self}/connection-requests` : null,
    },
  }
}

async function resolveRequestedAuthorizationDetails(
  deps: Deps,
  resourceServer: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  connection: ProviderResourceAuthorizationRecord | null,
  authorizationDetails: AuthorizationDetail[],
  identity: Awaited<ReturnType<typeof requireActiveIdentityAndBinding>>,
) {
  if (authorizationDetails.length === 0) return []
  if (hasDuplicateAuthorizationDetails(authorizationDetails)) {
    throw invalidAuthorizationDetails('Authorization details contain duplicate entries.')
  }
  if (!requiresAccountConnection(resourceServer)) {
    if (!isRealmrootResourceServer(resourceServer.id)) {
      throw invalidAuthorizationDetails('Native API resources do not accept authorization details.')
    }
    const available = await realmrootAuthorityDetails(deps, identity)
    if (
      !authorizationDetails.every((detail) =>
        available.some((candidate) => exactAuthorizationDetails([candidate], [detail])),
      )
    ) {
      throw invalidAuthorizationDetails('Authorization detail is not available to this Agent.')
    }
    return authorizationDetails
  }
  if (!connection)
    throw invalidAuthorizationDetails('Connect the Resource Server before selecting authorization details.')
  if (await serviceResourceFallbackAuthorization(deps, resourceServer, connection)) {
    throw invalidAuthorizationDetails('This Resource Server does not use authorization details.')
  }
  const available: AuthorizationDetail[] = []
  for (let offset = 0; ; ) {
    const catalog = await readResourceCatalog(deps, resourceServer, connection, identity.identity.id, {
      limit: 100,
      offset,
    })
    for (const item of catalog.items) available.push(item.authorizationDetail)
    if (!catalog.pagination.hasMore || catalog.pagination.nextOffset === null) break
    offset = catalog.pagination.nextOffset
  }
  if (
    !authorizationDetails.every((detail) =>
      available.some((candidate) => exactAuthorizationDetails([candidate], [detail])),
    )
  ) {
    throw invalidAuthorizationDetails('Authorization detail is not available through this Resource Server connection.')
  }
  return authorizationDetails
}

async function serviceResourceFallbackAuthorization(
  deps: Deps,
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  connection: ProviderResourceAuthorizationRecord,
) {
  if (connection.authorizationDetails.length > 0) return null
  const authorization = await connectorOAuthAuthorization(deps, resource, connection.clientGeneration ?? 1)
  if (!authorization) return { authorizationDetailsCatalogScope: null }
  return authorization.authorizationDetailsCatalogEndpoint ? null : authorization
}

function authorizationDetailDisplay(detail: AuthorizationDetail) {
  const identifier = Object.entries(detail).find(
    ([key, value]) => key !== 'type' && (typeof value === 'string' || typeof value === 'number'),
  )
  const label = identifier ? String(identifier[1]) : detail.type
  return { label, description: null, metadata: identifier ? { [identifier[0]]: label } : {} }
}

function connectionCoversRequest(
  connection: ProviderResourceAuthorizationRecord | null,
  request: AgentConnectionRequestRecord,
) {
  return Boolean(
    connection?.status === 'active' &&
      request.scopes.every((scope) =>
        authorityConstraintScopes(connection, request.authorizationDetails).includes(scope),
      ) &&
      isAuthorizationDetailsSubset(request.authorizationDetails, connection.authorizationDetails),
  )
}

async function isConnectionUsable(
  deps: Deps,
  resourceId: string,
  connection: ProviderResourceAuthorizationRecord,
): Promise<boolean> {
  const resource = await deps.authorization.findResource(resourceId)
  if (resource && brokeredAccountConnection(resource)) return true
  try {
    const authorization = await requireActiveConnectorAuthorization(deps, resourceId, connection.clientGeneration ?? 1)
    await refreshConnectionToken(deps, connection, authorization)
    return true
  } catch (error) {
    if (error instanceof OAuthError && ['invalid_grant', 'temporarily_unavailable'].includes(error.error)) return false
    if (!(error instanceof ApiError)) throw error
    if (error.status === 502) return false
    if (error.status !== 401) throw error
    await deps.externalResources.revokeConnection(connection.id, new Date())
    return false
  }
}

function mergeAuthorizationDetails(current: AuthorizationDetail[], requested: AuthorizationDetail[]) {
  const entries = new Map(current.map((detail) => [canonicalJson(detail), detail]))
  for (const detail of requested) entries.set(canonicalJson(detail), detail)
  return [...entries.values()]
}

async function refreshConnectionToken(
  deps: Deps,
  connection: ProviderResourceAuthorizationRecord,
  authorization: ExternalResourceAuthorizationRecord,
) {
  if (connection.credentialCustody === 'resource_server' || !connection.encryptedTokens) {
    throw new Error('Realmroot-custodied resource credentials are required for OAuth refresh.')
  }
  const payload = JSON.parse(
    await deps.secrets.open(connection.encryptedTokens, connectionTokensContext(connection.id)),
  ) as Record<string, unknown>
  if (connection.credentialExpiresAt && connection.credentialExpiresAt.getTime() > Date.now() + 30_000) {
    return {
      accessToken: requiredString(payload, 'accessToken', 'Stored resource connection'),
      expiresAt: connection.credentialExpiresAt,
      scopes: connection.grantedScopes,
    }
  }
  const expectedVersion = connection.credentialVersion ?? 1
  const claimId = deps.ids.generate()
  const now = new Date()
  if (
    !(await deps.externalResources.claimConnectionRefresh({
      id: connection.id,
      expectedVersion,
      claimId,
      now,
      claimExpiresAt: new Date(now.getTime() + 15_000),
    }))
  ) {
    throw oauthError(
      'temporarily_unavailable',
      'Provider credential refresh is already in progress.',
      503,
      {},
      { 'Retry-After': '1' },
    )
  }
  const refreshToken = requiredString(payload, 'refreshToken', 'Stored resource connection')
  const clientSecret = authorizationClientSecret(authorization)
  try {
    const token = await postForm(
      deps,
      authorization.tokenEndpoint,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        ...(connection.authorizationDetails.length > 0
          ? { authorization_details: JSON.stringify(connection.authorizationDetails) }
          : {}),
      },
      authorization.clientId,
      clientSecret,
      new Headers(),
      true,
    )
    const accessToken = requiredString(token, 'access_token', 'OAuth refresh response')
    const nextRefreshToken = optionalString(token, 'refresh_token') ?? refreshToken
    const scopes = scopeString(token.scope) ?? connection.grantedScopes
    const authorizationDetails =
      token.authorization_details === undefined
        ? connection.authorizationDetails
        : readAuthorizationDetails(
            token.authorization_details,
            connection.authorizationDetails.length > 0,
            connection.authorizationDetails.map((detail) => detail.type),
            'OAuth refresh response',
          )
    if (!exactAuthorizationDetails(authorizationDetails, connection.authorizationDetails)) {
      throw unauthorized('Target authorization server changed authorization details during refresh.')
    }
    const refreshedAt = new Date()
    const expiresAt = tokenExpiry(token, refreshedAt)
    const updated = await deps.externalResources.completeConnectionRefresh(connection.id, {
      expectedVersion,
      claimId,
      encryptedTokens: await deps.secrets.seal(
        JSON.stringify({ accessToken, refreshToken: nextRefreshToken, scope: scopes.join(' ') }),
        connectionTokensContext(connection.id),
      ),
      credentialExpiresAt: expiresAt,
      updatedAt: refreshedAt,
    })
    if (!updated) {
      throw oauthError('temporarily_unavailable', 'Provider credential refresh changed concurrently.', 503)
    }
    return { accessToken, expiresAt, scopes }
  } catch (error) {
    if (error instanceof OAuthError && error.error === 'invalid_grant') {
      await deps.externalResources.revokeConnection(connection.id, new Date())
      throw error
    }
    await deps.externalResources.releaseConnectionRefresh(connection.id, expectedVersion, claimId, new Date())
    throw error
  }
}

async function requirePendingAccessRequestByToken(deps: Deps, token: string) {
  const request = await deps.externalResources.findAccessRequestByApprovalTokenHash(await sha256(token))
  if (!request || request.status !== 'pending' || request.expiresAt.getTime() <= Date.now()) {
    throw notFound('Pending Agent access request was not found.')
  }
  return request
}

async function resolveResourceConnectionApproval(deps: Deps, approvalToken: string, actorUserId: string) {
  const request = await deps.externalResources.findAgentConnectionRequestByApprovalTokenHash(
    await sha256(approvalToken),
  )
  if (!request || request.expiresAt.getTime() <= Date.now()) {
    throw notFound('Pending connection request was not found.')
  }
  const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
  const binding = identity?.bindings.find(
    (candidate) => candidate.id === request.bindingId && candidate.status === 'active',
  )
  if (!identity || identity.identity.status !== 'active' || !binding) {
    throw notFound('Pending connection request was not found.')
  }
  if (!(await controlsAgentIdentity(deps, request.agentIdentityId, actorUserId))) {
    throw forbidden('Agent controller access is required.')
  }
  const resource = await requireEnabledResource(deps, request.resourceId)
  if (!requiresAccountConnection(resource)) throw badRequest('Native Resource Servers do not use account connections.')
  const connection = await deps.externalResources.findConnectionByOwnerResource({
    resourceId: resource.id,
    ownerUserId: identity.identity.ownerUserId,
    ownerOrganizationId: identity.identity.ownerOrganizationId,
  })
  return { request, identity, resource, connection }
}

async function requireControlledAccessRequest(deps: Deps, requestId: string, actorUserId: string) {
  const request = await deps.externalResources.findAccessRequest(requestId)
  if (!request) throw notFound('Agent access request was not found.')
  await requireControlledRequestTarget(deps, request, actorUserId)
  return toAgentAccessRequest(request, await requestHostId(deps, request), null)
}

async function requestHostId(deps: Deps, request: AgentAccessRequestRecord) {
  const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
  const binding = identity?.bindings.find((candidate) => candidate.id === request.bindingId)
  if (!binding) throw notFound('Agent host binding was not found.')
  return binding.hostId
}

async function requireExternalResource(deps: Deps, resourceId: string) {
  const resource = await deps.authorization.findResource(resourceId)
  if (resource?.accessMode !== 'external_oauth') throw notFound('External OAuth Resource Server was not found.')
  return resource
}

async function requireActiveExternalAuthorization(deps: Deps, resourceId: string, clientGeneration?: number) {
  const resource = await deps.authorization.findResource(resourceId)
  if (resource?.accessMode !== 'external_oauth') {
    throw notFound('Active external API resource authorization was not found.')
  }
  return requireActiveConnectorAuthorization(deps, resourceId, clientGeneration)
}

async function requireActiveConnectorAuthorization(deps: Deps, resourceId: string, clientGeneration?: number) {
  const authorization = await findExternalAuthorization(deps, resourceId, clientGeneration)
  if (!authorization || authorization.status !== 'active') {
    throw notFound('Active external API resource authorization was not found.')
  }
  return authorization
}

async function findExternalAuthorization(
  deps: Deps,
  resourceId: string,
  clientGeneration?: number,
): Promise<ResolvedExternalAuthorization | null> {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource?.connectorId || resource.accessMode === 'brokered') return null
  const connector = await deps.connectors.findById(resource.connectorId)
  if (
    !connector ||
    connector.providerType !== 'generic_oauth' ||
    !connector.clientId ||
    !connector.clientSecret ||
    !connector.issuer ||
    !connector.authorizationEndpoint ||
    !connector.tokenEndpoint ||
    !connector.userInfoEndpoint ||
    !connector.jwksEndpoint ||
    !connector.revocationEndpoint
  ) {
    return null
  }
  const currentGeneration = connector.clientGeneration ?? 1
  const requestedGeneration = clientGeneration ?? currentGeneration
  const retired = connector.retiredClientGenerations?.find((candidate) => candidate.generation === requestedGeneration)
  if (requestedGeneration !== currentGeneration && !retired) return null
  const clientId = retired?.clientId ?? connector.clientId
  const clientSecret = retired
    ? await deps.secrets.open(retired.encryptedClientSecret, retired.clientSecretContext)
    : connector.clientSecret
  return {
    resourceId,
    connectorId: connector.id,
    resourceUrl: resource.resourceUrl,
    issuer: connector.issuer,
    authorizationEndpoint: connector.authorizationEndpoint,
    tokenEndpoint: connector.tokenEndpoint,
    pushedAuthorizationRequestEndpoint:
      typeof connector.providerMetadata?.pushed_authorization_request_endpoint === 'string'
        ? connector.providerMetadata.pushed_authorization_request_endpoint
        : null,
    authorizationDetailsTypesSupported: metadataStringArray(
      connector.providerMetadata?.authorization_details_types_supported,
    ),
    authorizationDetailsCatalogEndpoint:
      typeof connector.providerMetadata?.authorization_details_catalog_endpoint === 'string'
        ? connector.providerMetadata.authorization_details_catalog_endpoint
        : null,
    authorizationDetailsCatalogScope:
      typeof connector.providerMetadata?.authorization_details_catalog_scope === 'string'
        ? connector.providerMetadata.authorization_details_catalog_scope
        : null,
    registrationEndpoint: connector.registrationEndpoint,
    revocationEndpoint: connector.revocationEndpoint,
    jwksUri: connector.jwksEndpoint,
    userInfoEndpoint: connector.userInfoEndpoint,
    registrationMode: connector.registrationMode ?? 'manual',
    clientId,
    clientGeneration: requestedGeneration,
    encryptedClientSecret: clientSecret,
    encryptedRegistrationAccessToken: null,
    metadata: connector.providerMetadata ?? {},
    status: connector.enabled ? 'active' : 'invalid',
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt,
  }
}

function authorizationClientSecret(authorization: ResolvedExternalAuthorization) {
  return authorization.encryptedClientSecret
}

function brokeredAccountConnection(resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>) {
  return resource.accessMode === 'brokered' && resource.scopeRegistry?.accountConnection?.mode === 'brokered'
    ? resource.scopeRegistry.accountConnection
    : null
}

function requiresAccountConnection(resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>) {
  return resource.connectorId !== null
}

async function externalOAuthAuthorization(
  deps: Deps,
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  clientGeneration?: number,
) {
  if (resource.accessMode !== 'external_oauth') return null
  return requireActiveExternalAuthorization(deps, resource.id, clientGeneration)
}

async function connectorOAuthAuthorization(
  deps: Deps,
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  clientGeneration?: number,
) {
  if (!resource.connectorId || resource.accessMode === 'brokered') return null
  return requireActiveConnectorAuthorization(deps, resource.id, clientGeneration)
}

async function requireEnabledResource(deps: Deps, resourceId: string) {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource?.enabled) throw notFound('Enabled Resource Server was not found.')
  await connectorOAuthAuthorization(deps, resource)
  return resource
}

async function requireActiveIdentityAndBinding(deps: Deps, principal: AgentResourcePrincipal) {
  const identity = await deps.agentIdentities.findIdentity(principal.identityId)
  const binding = identity?.bindings.find(
    (candidate) =>
      candidate.status === 'active' &&
      candidate.hostId === principal.hostId &&
      candidate.protocolAgentId === principal.protocolAgentId,
  )
  if (!identity || identity.identity.status !== 'active' || !binding) {
    throw forbidden('An active Agent identity and host binding are required.')
  }
  return identity
}

async function requireControlledConnection(deps: Deps, connectionId: string, actorUserId: string) {
  const connection = await deps.externalResources.findConnection(connectionId)
  if (!connection) throw notFound('Resource account connection was not found.')
  if (connection.ownerUserId === actorUserId) return connection
  if (connection.ownerOrganizationId) {
    if (await organizationUserHasScope(deps, connection.ownerOrganizationId, actorUserId, 'agents:write')) {
      return connection
    }
  }
  throw forbidden('Resource account controller access is required.')
}

async function requireControlledRequestTarget(deps: Deps, request: AgentAccessRequestRecord, actorUserId: string) {
  if (request.connectionId) return requireControlledConnection(deps, request.connectionId, actorUserId)
  if (await controlsAgentIdentity(deps, request.agentIdentityId, actorUserId)) return null
  throw forbidden('Agent controller access is required.')
}

async function controlsAgentIdentity(deps: Deps, identityId: string, actorUserId: string) {
  const identity = await deps.agentIdentities.findIdentity(identityId)
  if (!identity) return false
  if (identity.identity.ownerUserId === actorUserId) return true
  if (!identity.identity.ownerOrganizationId) return false
  return organizationUserHasScope(deps, identity.identity.ownerOrganizationId, actorUserId, 'agents:write')
}

async function requireConnectionOwnerControl(
  deps: Deps,
  owner: CreateResourceConnectionIntentRequest['owner'],
  actorUserId: string,
) {
  if (owner.type === 'user') return
  if (!(await organizationUserHasScope(deps, owner.organizationId, actorUserId, 'agents:write'))) {
    throw forbidden('Organization credential manager access is required.')
  }
}

function assertConnectionInHomeSpace(
  connection: ProviderResourceAuthorizationRecord,
  ownerUserId: string | null,
  ownerOrganizationId: string | null,
) {
  if (
    (ownerUserId && connection.ownerUserId === ownerUserId) ||
    (ownerOrganizationId && connection.ownerOrganizationId === ownerOrganizationId)
  ) {
    return
  }
  throw forbidden('Resource account connection is outside the Agent home space.')
}

async function resourceAuditRecord(
  deps: Deps,
  input: {
    action: string
    result: string
    principal?: AgentResourcePrincipal
    request?: AgentAccessRequestRecord
    resourceId: string
    connection: ProviderResourceAuthorizationRecord | null
    accessRequestId: string | null
    controllerUserId?: string
    scopes: string[]
    authorizationDetails?: AuthorizationDetail[]
    reasonCode: string | null
  },
) {
  const tenant = await resolveAuditTenant(deps, input)
  const authorizationDetails =
    input.authorizationDetails ?? input.request?.authorizationDetails ?? input.connection?.authorizationDetails ?? []
  const authorizationDetailProjections = authorizationDetails.map((detail) => ({
    type: detail.type,
    ...(typeof detail.identifier === 'string' ? { identifier: detail.identifier } : {}),
  }))
  return {
    id: deps.ids.generate(),
    action: input.action,
    result: input.result,
    realmOwned: false,
    ownerUserId: tenant.type === 'user' ? tenant.id : null,
    ownerOrganizationId: tenant.type === 'organization' ? tenant.id : null,
    controllerUserId: input.controllerUserId ?? null,
    subjectIssuer: input.principal?.issuer ?? null,
    subject: input.principal?.subject ?? null,
    agentIdentityId: input.principal?.identityId ?? input.request?.agentIdentityId ?? null,
    hostId: input.principal?.hostId ?? null,
    resourceId: input.resourceId,
    resourceConnectionId: input.connection?.id ?? null,
    accessRequestId: input.accessRequestId,
    scopes: input.scopes,
    reasonCode: input.reasonCode,
    metadata:
      authorizationDetailProjections.length > 0 ? { authorizationDetails: authorizationDetailProjections } : null,
    occurredAt: new Date(),
  }
}

async function resolveAuditTenant(
  deps: Deps,
  input: {
    principal?: AgentResourcePrincipal
    request?: AgentAccessRequestRecord
    connection: ProviderResourceAuthorizationRecord | null
  },
) {
  if (input.connection?.ownerUserId) return { type: 'user' as const, id: input.connection.ownerUserId }
  if (input.connection?.ownerOrganizationId) {
    return { type: 'organization' as const, id: input.connection.ownerOrganizationId }
  }
  const identityId = input.principal?.identityId ?? input.request?.agentIdentityId
  if (!identityId) throw new Error('Agent audit event has no tenant-owned resource.')
  const identity = await deps.agentIdentities.findIdentity(identityId)
  if (!identity) throw new Error(`Agent identity ${identityId} was not found while writing its audit event.`)
  return identity.identity.ownerUserId
    ? { type: 'user' as const, id: identity.identity.ownerUserId }
    : { type: 'organization' as const, id: identity.identity.ownerOrganizationId! }
}

async function revokeUncoveredEntitlements(
  deps: Deps,
  connection: ProviderResourceAuthorizationRecord,
  authorizationDetailsRequired: boolean,
  controllerUserId: string,
  now: Date,
) {
  for (const entitlement of await deps.externalResources.listActiveEntitlementsByConnection(connection.id, now)) {
    const covered =
      connection.grantedScopes.includes(entitlement.scope) &&
      (!authorizationDetailsRequired || entitlement.authorizationDetails.length > 0) &&
      isAuthorizationDetailsSubset(entitlement.authorizationDetails, connection.authorizationDetails)
    if (covered) continue
    const leaseIds = await revokeEntitlementTokenLeasesAtTarget(deps, entitlement, now)
    const audit = await resourceAuditRecord(deps, {
      action: 'api_resource.access_revoked',
      result: 'allowed',
      resourceId: entitlement.resourceServerId,
      connection,
      accessRequestId: entitlement.sourceAccessRequestId,
      controllerUserId,
      scopes: [entitlement.scope],
      authorizationDetails: entitlement.authorizationDetails,
      reasonCode: 'connection_authorization_changed',
    })
    await deps.externalResources.endEntitlementWithAudit(entitlement.id, 'revoked', leaseIds, now, audit)
  }
}

function assertAuthorizationDetailsSupported(
  authorizationDetails: AuthorizationDetail[],
  authorization: ResolvedExternalAuthorization,
) {
  if (authorizationDetails.length === 0) return
  if (!authorization.pushedAuthorizationRequestEndpoint) {
    throw invalidAuthorizationDetails('RAR-enabled resources require a pushed authorization request endpoint.')
  }
  if (authorizationDetails.some((detail) => !authorization.authorizationDetailsTypesSupported.includes(detail.type))) {
    throw invalidAuthorizationDetails(
      'The authorization server does not support every configured authorization detail type.',
    )
  }
}

function assertAuthorizationDetailsSelection(
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  connection: ProviderResourceAuthorizationRecord | null,
  authorizationDetails: AuthorizationDetail[],
) {
  if (!requiresAccountConnection(resource)) {
    if (isRealmrootResourceServer(resource.id)) {
      assertRealmrootAuthoritySelection(authorizationDetails)
      return
    }
    if (authorizationDetails.length > 0) {
      throw invalidAuthorizationDetails('Native API resources do not accept authorization details.')
    }
    return
  }
  const required = resource.authorizationDetails.length > 0
  if (!required && authorizationDetails.length > 0) {
    throw invalidAuthorizationDetails('This external API resource does not use authorization details.')
  }
  if (!required) return
  if (!connection || connection.authorizationDetails.length === 0) {
    throw invalidAuthorizationDetails('The resource account must be explicitly reauthorized for authorization details.')
  }
  if (authorizationDetails.length === 0) {
    throw invalidAuthorizationDetails('Select at least one concrete authorization detail entry.')
  }
  assertConcreteAuthorizationDetails(resource.authorizationDetails, authorizationDetails, 'Selected')
  if (hasDuplicateAuthorizationDetails(authorizationDetails)) {
    throw invalidAuthorizationDetails('Selected authorization details contain duplicate entries.')
  }
}

function assertAccessRequestAuthorizationDetails(
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  connection: ProviderResourceAuthorizationRecord | null,
  authorizationDetails: AuthorizationDetail[],
) {
  if (!requiresAccountConnection(resource)) {
    if (isRealmrootResourceServer(resource.id)) {
      assertRealmrootAuthoritySelection(authorizationDetails)
      return
    }
    if (authorizationDetails.length > 0) {
      throw invalidAuthorizationDetails('Native API resources do not accept authorization details.')
    }
    return
  }
  const supportedTypes = new Set(resource.authorizationDetails.map((detail) => detail.type))
  if (supportedTypes.size === 0) {
    if (authorizationDetails.length > 0) {
      throw invalidAuthorizationDetails('This external API resource does not use authorization details.')
    }
    return
  }
  if (authorizationDetails.length === 0) {
    throw invalidAuthorizationDetails('Select at least one concrete authorization detail entry.')
  }
  if (authorizationDetails.some((detail) => !supportedTypes.has(detail.type))) {
    throw invalidAuthorizationDetails('Requested authorization details contain an unsupported type.')
  }
  assertConcreteAuthorizationDetails(resource.authorizationDetails, authorizationDetails, 'Requested')
  if (hasDuplicateAuthorizationDetails(authorizationDetails)) {
    throw invalidAuthorizationDetails('Requested authorization details contain duplicate entries.')
  }
  if (!connection || !isAuthorizationDetailsSubset(authorizationDetails, connection.authorizationDetails)) {
    throw invalidAuthorizationDetails('Requested authorization details exceed the connected account boundary.')
  }
}

function assertRealmrootAuthoritySelection(authorizationDetails: AuthorizationDetail[]) {
  const detail = authorizationDetails[0]
  if (
    authorizationDetails.length !== 1 ||
    detail?.type !== 'realmroot_authority' ||
    !['organization', 'user'].includes(String(detail.authority)) ||
    typeof detail.id !== 'string'
  ) {
    throw invalidAuthorizationDetails('Select exactly one Realmroot authority detail.')
  }
}

function assertAuthorizationDetailsSubset(
  requested: AuthorizationDetail[],
  allowed: AuthorizationDetail[],
  boundary: string,
) {
  if (!isAuthorizationDetailsSubset(requested, allowed)) {
    throw invalidAuthorizationDetails(`Requested authorization details exceed the ${boundary} boundary.`)
  }
}

function isAuthorizationDetailsSubset(requested: AuthorizationDetail[], allowed: AuthorizationDetail[]) {
  const remaining = allowed.map(canonicalJson)
  for (const detail of requested.map(canonicalJson)) {
    const index = remaining.indexOf(detail)
    if (index === -1) return false
    remaining.splice(index, 1)
  }
  return true
}

function authorizationSelectorCovers(requested: AuthorizationDetail, selector: AuthorizationDetail): boolean {
  return jsonSelectorCovers(requested, selector)
}

function jsonSelectorCovers(requested: unknown, selector: unknown): boolean {
  if (requested === null || selector === null) return requested === selector
  if (Array.isArray(requested)) {
    return (
      Array.isArray(selector) &&
      requested.every((item) => selector.some((candidate) => jsonSelectorCovers(item, candidate)))
    )
  }
  if (typeof requested === 'object') {
    if (typeof selector !== 'object' || Array.isArray(selector)) return false
    return Object.entries(requested as Record<string, unknown>).every(([key, value]) =>
      jsonSelectorCovers(value, (selector as Record<string, unknown>)[key]),
    )
  }
  return requested === selector
}

function validateAuthorityConstraints(
  constraints: ProviderAuthorityConstraint[],
  authorizationDetails: AuthorizationDetail[],
  grantedScopes: string[],
) {
  if (
    constraints.some(
      (constraint) =>
        !isAuthorizationDetailsSubset(constraint.authorizationDetails, authorizationDetails) ||
        constraint.scopes.some((scope) => !grantedScopes.includes(scope)),
    ) ||
    authorizationDetails.some(
      (detail) =>
        !constraints.some((constraint) =>
          constraint.authorizationDetails.some((selector) => authorizationSelectorCovers(detail, selector)),
        ),
    )
  ) {
    throw invalidAuthorizationDetails('Brokered connection authority constraints do not cover its granted authority.')
  }
}

function authorityConstraintScopes(
  connection: ProviderResourceAuthorizationRecord,
  authorizationDetails: AuthorizationDetail[],
) {
  if (authorizationDetails.length === 0) return connection.grantedScopes
  const constraints = connection.authorityConstraints ?? []
  if (constraints.length === 0) return connection.grantedScopes
  const scopesByDetail = authorizationDetails.map((detail) => [
    ...new Set(
      constraints
        .filter((constraint) =>
          constraint.authorizationDetails.some((selector) => authorizationSelectorCovers(detail, selector)),
        )
        .flatMap((constraint) => constraint.scopes),
    ),
  ])
  if (scopesByDetail.some((scopes) => scopes.length === 0)) return []
  return connection.grantedScopes.filter((scope) => scopesByDetail.every((scopes) => scopes.includes(scope)))
}

function assertAuthorityConstraintScopes(
  requested: string[],
  connection: ProviderResourceAuthorizationRecord,
  authorizationDetails: AuthorizationDetail[],
) {
  assertScopeSubset(requested, authorityConstraintScopes(connection, authorizationDetails), 'selected authority')
}

function exactAuthorizationDetails(left: AuthorizationDetail[], right: AuthorizationDetail[]) {
  if (left.length !== right.length) return false
  const leftEntries = left.map(canonicalJson).sort()
  const rightEntries = right.map(canonicalJson).sort()
  return leftEntries.every((value, index) => value === rightEntries[index])
}

function authorizationDetailsMatchRequest(approved: AuthorizationDetail[], requested: AuthorizationDetail[]) {
  return new Set(approved.map(canonicalJson)).size === approved.length && exactAuthorizationDetails(approved, requested)
}

function assertConcreteAuthorizationDetails(
  templates: AuthorizationDetail[],
  authorizationDetails: AuthorizationDetail[],
  label: string,
) {
  if (
    authorizationDetails.some(
      (detail) =>
        !templates.some((template) => authorizationDetailMatchesTemplate(detail, template)) ||
        templates.some((template) => canonicalJson(template) === canonicalJson(detail)),
    )
  ) {
    throw invalidAuthorizationDetails(`${label} authorization details must identify concrete resource contexts.`)
  }
}

function hasDuplicateAuthorizationDetails(authorizationDetails: AuthorizationDetail[]) {
  const entries = authorizationDetails.map(canonicalJson)
  return new Set(entries).size !== entries.length
}

function authorizationDetailMatchesTemplate(detail: AuthorizationDetail, template: AuthorizationDetail) {
  return Object.entries(template).every(([key, value]) => canonicalJson(detail[key]) === canonicalJson(value))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)!
}

function readAuthorizationDetails(value: unknown, required: boolean, allowedTypes: string[], label: string) {
  if (value === undefined && !required) return []
  const parsed = authorizationDetailsSchema.safeParse(value)
  if (!parsed.success || (required && parsed.data.length === 0)) {
    throw invalidAuthorizationDetails(`${label} has malformed authorization_details.`)
  }
  if (parsed.data.some((detail) => !allowedTypes.includes(detail.type))) {
    throw invalidAuthorizationDetails(`${label} contains an unknown authorization detail type.`)
  }
  return parsed.data
}

function invalidAuthorizationDetails(description: string) {
  return oauthError('invalid_authorization_details', description)
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...new Set(value as string[])] : []
}

async function fetchObject(
  deps: Deps,
  url: string,
  message: string,
  headers = new Headers({ accept: 'application/json' }),
) {
  const response = await deps.externalHttp.fetch(new Request(url, { headers }))
  if (!response.ok) throw badRequest(message)
  return readObject(response, message)
}

async function postForm(
  deps: Deps,
  url: string,
  body: Record<string, string>,
  clientId: string,
  clientSecret: string,
  extraHeaders = new Headers(),
  preserveInvalidGrant = false,
) {
  return (await postFormResponse(deps, url, body, clientId, clientSecret, extraHeaders, preserveInvalidGrant)).body
}

async function postFormResponse(
  deps: Deps,
  url: string,
  body: Record<string, string>,
  clientId: string,
  clientSecret: string,
  extraHeaders = new Headers(),
  preserveInvalidGrant = false,
) {
  const headers = new Headers(extraHeaders)
  headers.set('accept', 'application/json')
  headers.set('authorization', `Basic ${base64(`${clientId}:${clientSecret}`)}`)
  headers.set('content-type', 'application/x-www-form-urlencoded')
  let response: Response
  try {
    response = await fetchExternalAuthorization(
      deps,
      new Request(url, { method: 'POST', headers, body: new URLSearchParams(body) }),
    )
  } catch {
    throw badGateway('External authorization server is unavailable.')
  }
  if (!response.ok) {
    const providerError = await readOAuthError(response)
    if (preserveInvalidGrant && providerError?.error === 'invalid_grant') {
      throw oauthError('invalid_grant', 'Provider refresh token is no longer valid.')
    }
    if (providerError?.error === 'use_dpop_nonce') {
      const nonce = response.headers.get('dpop-nonce')
      if (!nonce || !validDpopNonce(nonce)) {
        throw badGateway('External authorization server returned an invalid DPoP nonce challenge.')
      }
      throw oauthError(
        providerError.error,
        providerError.description ?? 'Authorization server requires nonce in DPoP proof.',
        400,
        {},
        { 'DPoP-Nonce': nonce },
      )
    }
    const detail = providerError?.detail ?? null
    throw unauthorized(
      detail
        ? `External authorization server rejected the token request: ${detail}.`
        : 'External authorization server rejected the token request.',
    )
  }
  const dpopNonce = response.headers.get('dpop-nonce')
  if (dpopNonce !== null && !validDpopNonce(dpopNonce)) {
    throw badGateway('External authorization server returned an invalid DPoP nonce.')
  }
  return {
    body: await readObject(response, 'External authorization server response is invalid.'),
    dpopNonce,
  }
}

async function fetchExternalAuthorization(deps: Deps, request: Request) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), externalAuthorizationTimeoutMs)
  try {
    return await Promise.race([
      deps.externalHttp.fetch(new Request(request, { signal: controller.signal })),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('external authorization timeout')), {
          once: true,
        })
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function readOAuthError(
  response: Response,
): Promise<{ error: string; description: string | null; detail: string } | null> {
  try {
    const body = (await response.json()) as Record<string, unknown>
    const error =
      typeof body.error === 'string' ? body.error : typeof body.code === 'string' ? body.code.toLowerCase() : null
    const description =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.message === 'string'
          ? body.message
          : null
    if (!error) return null
    return { error, description, detail: description ? `${error}: ${description}` : error }
  } catch {
    return null
  }
}

function validDpopNonce(value: string) {
  return value.length <= 4096 && /^[\x21\x23-\x5B\x5D-\x7E]+$/.test(value)
}

async function postPushedAuthorizationRequest(
  deps: Deps,
  url: string,
  body: Record<string, string>,
  clientId: string,
  clientSecret: string,
) {
  const response = await deps.externalHttp.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${base64(`${clientId}:${clientSecret}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
    }),
  )
  if (response.status !== 201) {
    const error = await response.json().catch(() => null)
    const value = error && typeof error === 'object' && !Array.isArray(error) ? (error as Record<string, unknown>) : {}
    throw oauthError(
      typeof value.error === 'string' ? value.error : 'invalid_request',
      typeof value.error_description === 'string'
        ? value.error_description
        : 'External authorization server rejected the pushed authorization request.',
      response.status >= 400 ? response.status : 400,
    )
  }
  return readObject(response, 'Pushed authorization response is invalid.')
}

async function postEmptyForm(
  deps: Deps,
  url: string,
  body: Record<string, string>,
  clientId: string,
  clientSecret: string,
) {
  const headers = new Headers({
    authorization: `Basic ${base64(`${clientId}:${clientSecret}`)}`,
    'content-type': 'application/x-www-form-urlencoded',
  })
  let response: Response
  try {
    response = await deps.externalHttp.fetch(
      new Request(url, { method: 'POST', headers, body: new URLSearchParams(body) }),
    )
  } catch {
    throw badGateway('External authorization server revocation is unavailable.')
  }
  if (!response.ok) throw unauthorized('External authorization server rejected the revocation request.')
}

async function readObject(response: Response, message: string) {
  const value = await response.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message)
  return value as Record<string, unknown>
}

function requiredString(value: Record<string, unknown>, field: string, label: string) {
  const result = value[field]
  if (typeof result !== 'string' || result.length === 0) throw badRequest(`${label} is missing ${field}.`)
  return result
}

function optionalString(value: Record<string, unknown>, field: string) {
  return typeof value[field] === 'string' && value[field].length > 0 ? value[field] : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function requiredPositiveInteger(value: Record<string, unknown>, field: string, label: string) {
  const result = value[field]
  if (typeof result !== 'number' || !Number.isInteger(result) || result <= 0) {
    throw badRequest(`${label} has invalid ${field}.`)
  }
  return result
}

function scopeString(value: unknown) {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean).sort() : null
}

function tokenExpiry(token: Record<string, unknown>, now: Date) {
  return typeof token.expires_in === 'number' && Number.isFinite(token.expires_in) && token.expires_in > 0
    ? new Date(now.getTime() + token.expires_in * 1000)
    : null
}

function assertScopeSubset(requested: string[], allowed: string[], boundary: string) {
  const missing = requested.filter((scope) => !allowed.includes(scope))
  if (missing.length > 0) throw badRequest(`Requested scopes exceed the ${boundary} boundary: ${missing.join(', ')}.`)
}

function assertOAuthScopeSubset(requested: string[], allowed: string[], boundary: string) {
  const missing = requested.filter((scope) => !allowed.includes(scope))
  if (missing.length > 0) throw oauthError('invalid_scope', `Requested scopes exceed the ${boundary} boundary.`)
}

function exactScopes(left: string[], right: string[]) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

function earliestEntitlementExpiry(entitlements: ResourceScopeEntitlementRecord[]) {
  const expiries = entitlements.flatMap((entitlement) => (entitlement.expiresAt ? [entitlement.expiresAt] : []))
  return expiries.length > 0 ? new Date(Math.min(...expiries.map((expiresAt) => expiresAt.getTime()))) : null
}

async function requireAgentResourceVisibility(
  deps: Deps,
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  identity: { ownerUserId: string | null; ownerOrganizationId: string | null },
) {
  const organizationIds = await activeIdentityOrganizationIds(deps, identity)
  if (!resource.availableToAgents || !activeResourceVisibleToAgent(resource, organizationIds)) {
    throw forbidden('Resource Server is not visible to this Agent.')
  }
}

async function activeIdentityOrganizationIds(
  deps: Deps,
  identity: { ownerUserId: string | null; ownerOrganizationId: string | null },
) {
  const candidateIds = identity.ownerOrganizationId
    ? [identity.ownerOrganizationId]
    : identity.ownerUserId
      ? (await deps.authorization.listUserMemberships(identity.ownerUserId)).map(
          (membership) => membership.organizationId,
        )
      : []
  const organizations = await Promise.all(
    [...new Set(candidateIds)].map((organizationId) => deps.authorization.findOrganization(organizationId)),
  )
  return new Set(
    organizations.flatMap((organization) => (organization && !organization.disabled ? [organization.id] : [])),
  )
}

function activeResourceVisibleToAgent(resource: ApiResourceResponse, organizationIds: ReadonlySet<string>) {
  if (activePublicResource(resource)) return true
  return [...organizationIds].some((organizationId) => activeResourceVisibleToOrganization(resource, organizationId))
}

function toExternalAuthorization(record: ExternalResourceAuthorizationRecord) {
  return {
    resourceId: record.resourceId,
    connectorId: record.connectorId,
    resourceUrl: record.resourceUrl,
    issuer: record.issuer,
    authorizationEndpoint: record.authorizationEndpoint,
    tokenEndpoint: record.tokenEndpoint,
    pushedAuthorizationRequestEndpoint: record.pushedAuthorizationRequestEndpoint,
    authorizationDetailsTypesSupported: record.authorizationDetailsTypesSupported,
    authorizationDetailsCatalogEndpoint: record.authorizationDetailsCatalogEndpoint,
    authorizationDetailsCatalogScope: record.authorizationDetailsCatalogScope,
    registrationEndpoint: record.registrationEndpoint,
    revocationEndpoint: record.revocationEndpoint,
    jwksUri: record.jwksUri,
    userInfoEndpoint: record.userInfoEndpoint,
    registrationMode: record.registrationMode as 'dynamic' | 'manual',
    clientId: record.clientId,
    clientSecretConfigured: true as const,
    status: record.status as 'pending' | 'active' | 'invalid',
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function omitResourceId(value: ReturnType<typeof toExternalAuthorization>) {
  const { resourceId: _, ...authorization } = value
  return authorization
}

function toResourceConnection(record: ProviderResourceAuthorizationRecord) {
  return {
    id: record.id,
    resourceId: record.resourceId,
    owner: record.ownerUserId
      ? { type: 'user' as const, userId: record.ownerUserId }
      : { type: 'organization' as const, organizationId: record.ownerOrganizationId! },
    externalSubject: record.externalSubject,
    displayName: record.displayName,
    grantedScopes: record.grantedScopes,
    authorizationDetails: record.authorizationDetails,
    authorityConstraints: record.authorityConstraints ?? [],
    status: record.status as 'active' | 'suspended' | 'revoked',
    credentialExpiresAt: record.credentialExpiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function toAgentAccessRequest(record: AgentAccessRequestRecord, hostId: string, approvalUrl: string | null) {
  return {
    id: record.id,
    resourceId: record.resourceId,
    connectionId: record.connectionId,
    agentIdentityId: record.agentIdentityId,
    hostId,
    scopes: record.scopes,
    authorizationDetails: record.authorizationDetails,
    reason: record.reason,
    status: record.status as 'pending' | 'approved' | 'denied' | 'consumed' | 'expired',
    approvalUrl,
    approvedEntitlements: record.approvedEntitlements,
    expiresAt: record.expiresAt.toISOString(),
    decidedAt: record.decidedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function toAccountConnection(record: ProviderResourceAuthorizationRecord): AccountConnection {
  return {
    id: record.id,
    apiResourceId: record.resourceId,
    owner: record.ownerUserId
      ? { type: 'user', userId: record.ownerUserId }
      : { type: 'organization', organizationId: record.ownerOrganizationId! },
    displayName: record.displayName,
    subjectHint: redactSubject(record.externalSubject),
    scopes: record.grantedScopes.filter((scope) => scope !== 'openid' && scope !== 'offline_access'),
    authorizationDetails: record.authorizationDetails,
    status: record.status as 'active' | 'suspended' | 'revoked',
    credentialExpiresAt: record.credentialExpiresAt?.toISOString() ?? null,
    authorizationUrl: null,
    expiresAt: null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function toResourceConnectionRequest(
  request: AgentConnectionRequestRecord,
  connected: boolean,
  apiOrigin: string,
  approvalUrl: string | null,
): ResourceConnectionRequest {
  const origin = apiOrigin.replace(/\/$/, '')
  const expired = !connected && request.expiresAt.getTime() <= Date.now()
  const status = connected ? 'connected' : expired ? 'expired' : 'pending'
  return {
    id: request.id,
    agentId: request.agentIdentityId,
    resourceServerId: request.resourceId,
    authorizationDetails: request.authorizationDetails,
    scopes: request.scopes,
    reason: request.reason,
    status,
    interaction: {
      type: 'user-approval',
      status: connected ? 'completed' : expired ? 'expired' : 'pending',
      url: status === 'pending' ? approvalUrl : null,
      expiresAt: status === 'pending' ? request.expiresAt.toISOString() : null,
    },
    links: {
      self: `${origin}/api/resource-servers/${encodeURIComponent(request.resourceId)}/connection-requests/${encodeURIComponent(request.id)}`,
    },
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
  }
}

function toPendingAccountConnection(
  pending: Awaited<ReturnType<typeof createResourceConnectionIntent>>,
  scopes: string[],
): AccountConnection {
  return {
    id: pending.id,
    apiResourceId: pending.resourceId,
    owner: pending.owner,
    displayName: null,
    subjectHint: null,
    scopes,
    authorizationDetails: pending.authorizationDetails,
    status: 'pending_authorization',
    credentialExpiresAt: null,
    authorizationUrl: pending.authorizationUrl,
    expiresAt: pending.expiresAt,
    createdAt: pending.createdAt,
    updatedAt: pending.updatedAt,
  }
}

function toAccessRequest(
  request: ReturnType<typeof toAgentAccessRequest> | Awaited<ReturnType<typeof getAgentAccessRequest>>,
  apiOrigin = '',
): AccessRequest {
  const origin = apiOrigin.replace(/\/$/, '')
  const interactionStatus =
    request.status === 'pending'
      ? 'pending'
      : request.status === 'denied'
        ? 'denied'
        : request.status === 'expired'
          ? 'expired'
          : 'completed'
  const self = `${origin}/api/agent/access-requests/${encodeURIComponent(request.id)}`
  return {
    id: request.id,
    agentId: request.agentIdentityId,
    resourceServerId: request.resourceId,
    authorizationDetails: request.authorizationDetails,
    scopes: request.scopes,
    reason: request.reason,
    status: request.status,
    interaction: {
      type: 'user-approval',
      status: interactionStatus,
      url: interactionStatus === 'pending' ? request.approvalUrl : null,
      expiresAt: interactionStatus === 'pending' ? request.expiresAt : null,
    },
    links: {
      self,
      credentials:
        (request.status === 'approved' || request.status === 'consumed') &&
        request.approvedEntitlements.length === request.scopes.length
          ? `${self}/credentials`
          : null,
    },
    credentialOffer: null,
    expiresAt: request.expiresAt,
    decidedAt: request.decidedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

async function agentAccessRequestRepresentation(
  deps: Deps,
  request: ReturnType<typeof toAgentAccessRequest> | Awaited<ReturnType<typeof getAgentAccessRequest>>,
  apiOrigin: string,
): Promise<AccessRequest> {
  const representation = toAccessRequest(request, apiOrigin)
  if (
    (request.status !== 'approved' && request.status !== 'consumed') ||
    request.approvedEntitlements.length !== request.scopes.length
  ) {
    return representation
  }
  const resourceServer = await requireEnabledResource(deps, request.resourceId)
  const authorization = await externalOAuthAuthorization(
    deps,
    resourceServer,
    request.connectionId
      ? ((await deps.externalResources.findConnection(request.connectionId))?.clientGeneration ?? 1)
      : 1,
  )
  const credentials = representation.links.credentials!
  return {
    ...representation,
    credentialOffer: {
      type: 'dpop',
      resourceIndicator: resourceServer.resourceUrl,
      authorizationDetails: request.authorizationDetails,
      endpoint: credentials,
      proof: {
        algorithm: 'ES256',
        method: 'POST',
        uri: authorization?.tokenEndpoint ?? credentials,
      },
    },
  }
}

function toPermission(
  record: ResourceScopeEntitlementRecord,
  resource: { id: string; identifier: string; name: string },
): AgentPermission {
  return {
    id: record.id,
    agentId: record.agentIdentityId!,
    target: {
      type: 'api-resource',
      apiResourceId: record.resourceServerId,
      ...(record.connectionId ? { accountConnectionId: record.connectionId } : {}),
    },
    resource: { id: resource.id, identifier: resource.identifier, name: resource.name },
    scope: record.scope,
    authorizationDetails: record.authorizationDetails,
    mode: record.mode as AgentPermission['mode'],
    ...resourceScopeEntitlementLifecycle(record),
    sourceAccessRequestId: record.sourceAccessRequestId,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    endedAt: record.endedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    links: {
      self: `/api/agents/${encodeURIComponent(record.agentIdentityId!)}/permissions/${encodeURIComponent(record.id)}`,
    },
  }
}

function redactSubject(subject: string) {
  return subject.length <= 4 ? '••••' : `••••${subject.slice(-4)}`
}

function resourceConnectionCallbackUrl(origin: string) {
  return `${origin.replace(/\/$/, '')}/oauth/account-connection/callback`
}

function connectionIntentContext(intentId: string) {
  return `resource-connection-intent:${intentId}:pkce-verifier`
}

function connectionTokensContext(connectionId: string) {
  return `resource-connection:${connectionId}:tokens`
}

function tokenLeaseContext(leaseId: string) {
  return `external-token-lease:${leaseId}:access-token`
}

function accessRequestTokenContext(requestId: string) {
  return `agent-access-request:${requestId}:approval-token`
}

function connectionRequestTokenContext(requestId: string) {
  return `agent-connection-request:${requestId}:approval-token`
}

function approvalUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/agent/resource-access/approve#token=${token}`
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64Url(new Uint8Array(digest))
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

function base64(value: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function createProtocolId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

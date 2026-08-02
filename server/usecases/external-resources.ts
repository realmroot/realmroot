import { badRequest, forbidden, notFound, oauthError, unauthorized } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type {
  AgentAccessGrantRecord,
  AgentAccessRequestRecord,
  ExternalResourceAuthorizationRecord,
  ResourceAccountConnectionRecord,
} from '@server/usecases/ports'
import type {
  AccessGrant,
  AccessRequest,
  AccessRequestApproval,
  AccountConnection,
  ApiResource,
  CreateAccessRequest,
  CreateAccountConnection,
} from '@shared/api/agent-api'
import { type AuthorizationDetail, authorizationDetailsSchema } from '@shared/api/authorization-details'
import type {
  CreateAgentAccessRequest,
  CreateResourceConnectionIntentRequest,
  DecideAgentAccessRequest,
} from '@shared/api/external-resources'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'
import { calculateJwkThumbprint, compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose'
import { getAgentRoleAuthorization } from './authorization'
import { readDeclaredScopes, validateRequestedScopes } from './resource-openapi'

const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
const jwtBearerGrantType = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'
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

export async function getApiResource(deps: Deps, resourceId: string): Promise<ApiResource> {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource) throw notFound('API resource was not found.')
  const authorization = await findExternalAuthorization(deps, resourceId)
  return {
    ...resource,
    authorization: authorization ? omitResourceId(toExternalAuthorization(authorization)) : null,
  }
}

export async function listApiResources(deps: Deps, pagination: PaginationInput, ownerOrganizationIds?: string[]) {
  const page = await deps.authorization.listResources(pagination, ownerOrganizationIds)
  return {
    items: await Promise.all(page.items.map((resource) => getApiResource(deps, resource.id))),
    pagination: page.pagination,
  }
}

export async function createResourceConnectionIntent(
  deps: Deps,
  resourceId: string,
  input: CreateResourceConnectionIntentRequest,
  actorUserId: string,
  callbackOrigin: string,
) {
  const resource = await requireExternalResource(deps, resourceId)
  if (!resource.enabled || resource.archivedAt) throw notFound('Enabled external API resource was not found.')
  const authorization = await requireActiveExternalAuthorization(deps, resourceId)
  await requireConnectionOwnerControl(deps, input.owner, actorUserId)
  const scopes = input.scopes
  await validateRequestedScopes(deps, resource.resourceUrl, scopes)
  const requestedScopes = [...new Set([...scopes, 'openid', 'offline_access'])].sort()
  const authorizationDetails = resource.authorizationDetails
  assertAuthorizationDetailsSupported(authorizationDetails, authorization)
  const id = createId('resconnint')
  const state = randomToken()
  const verifier = randomToken()
  const now = new Date()
  const redirectUri = resourceConnectionCallbackUrl(callbackOrigin)
  const authorizationParameters = {
    response_type: 'code',
    client_id: authorization.clientId,
    redirect_uri: redirectUri,
    resource: resource.resourceUrl,
    scope: requestedScopes.join(' '),
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    ...(authorizationDetails.length > 0 ? { authorization_details: JSON.stringify(authorizationDetails) } : {}),
  }
  let expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  let authorizationUrl: string
  if (authorizationDetails.length > 0) {
    const pushed = await postPushedAuthorizationRequest(
      deps,
      authorization.pushedAuthorizationRequestEndpoint!,
      authorizationParameters,
      authorization.clientId,
      authorizationClientSecret(authorization),
    )
    const requestUri = requiredString(pushed, 'request_uri', 'Pushed authorization response')
    const expiresIn = requiredPositiveInteger(pushed, 'expires_in', 'Pushed authorization response')
    expiresAt = new Date(Math.min(expiresAt.getTime(), now.getTime() + expiresIn * 1000))
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
    ownerUserId: actorUserId,
    ownerOrganizationId: input.owner.type === 'organization' ? input.owner.organizationId : null,
    scopes: requestedScopes,
    authorizationDetails,
    encryptedPkceVerifier: await deps.secrets.seal(verifier, connectionIntentContext(id)),
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
  const authorization = await requireActiveExternalAuthorization(deps, intent.resourceId)
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
  const ownerUserId = intent.ownerOrganizationId ? null : intent.ownerUserId
  const existing = await deps.externalResources.findConnectionByOwnerResource({
    resourceId: intent.resourceId,
    ownerUserId,
    ownerOrganizationId: intent.ownerOrganizationId,
  })
  if (existing?.status === 'active' && existing.externalSubject !== externalSubject) {
    throw badRequest('Disconnect the current resource account before connecting another account.')
  }
  const connectionId = existing?.id ?? intent.id
  const grantedScopes = scopeString(token.scope) ?? intent.scopes
  const authorizationInput = {
    externalSubject,
    displayName,
    encryptedTokens: await deps.secrets.seal(
      JSON.stringify({ accessToken, refreshToken, scope: grantedScopes.join(' ') }),
      connectionTokensContext(connectionId),
    ),
    grantedScopes,
    authorizationDetails,
    status: 'active' as const,
    credentialExpiresAt: expiresAt,
    revokedAt: null,
    updatedAt: now,
  }
  const connection = existing
    ? await deps.externalResources.replaceConnectionAuthorization(existing.id, intent.resourceId, authorizationInput)
    : await deps.externalResources.createConnection({
        id: connectionId,
        resourceId: intent.resourceId,
        ownerUserId,
        ownerOrganizationId: intent.ownerOrganizationId,
        ...authorizationInput,
        createdAt: now,
      })
  if (!connection) throw badRequest('The API resource was archived while completing the connection.')
  if (existing) {
    await revokeUncoveredGrants(deps, connection, intent.authorizationDetails.length > 0, intent.ownerUserId, now)
  }
  return {
    ...toResourceConnection(connection),
    returnTo: intent.returnTo,
  }
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
): Promise<AccountConnection> {
  if (input.context === 'access-request') {
    const request = await requirePendingAccessRequestByToken(deps, input.approvalToken)
    if (request.id !== input.accessRequestId) throw notFound('Agent access request was not found.')
    await requireControlledRequestTarget(deps, request, actorUserId)
    const resource = await requireEnabledResource(deps, request.resourceId)
    if (!resource.connectorId) {
      throw badRequest('Native API resources do not use account connections.')
    }
    const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
    if (!identity) throw notFound('Active Agent identity was not found.')
    const owner = identity.identity.ownerOrganizationId
      ? { type: 'organization' as const, organizationId: identity.identity.ownerOrganizationId }
      : { type: 'user' as const }
    const connectionScopes = request.scopes
    const pending = await createResourceConnectionIntent(
      deps,
      request.resourceId,
      { owner, scopes: connectionScopes, returnTo: 'access-approval' },
      actorUserId,
      callbackOrigin,
    )
    return toPendingAccountConnection(pending, connectionScopes)
  }
  const pending = await createResourceConnectionIntent(
    deps,
    input.apiResourceId,
    { owner: input.owner, scopes: input.scopes, returnTo: 'account-center' },
    actorUserId,
    callbackOrigin,
  )
  return toPendingAccountConnection(pending, input.scopes)
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
  if (!resource.connectorId) {
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
    (resource) => resource.connectorId !== null,
  )
  const connectable = []
  for (const resource of resources) {
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

export async function revokeResourceConnection(deps: Deps, connectionId: string, actorUserId: string) {
  const connection = await requireControlledConnection(deps, connectionId, actorUserId)
  const grants = await deps.externalResources.listActiveGrantsByConnection(connection.id)
  for (const grant of grants) await revokeAgentAccessGrant(deps, grant.id, actorUserId)
  if (!(await deps.externalResources.revokeConnection(connectionId, new Date()))) {
    throw badRequest('Resource account connection is already revoked.')
  }
}

export async function discoverAgentResources(deps: Deps, principal: AgentResourcePrincipal) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const connections = identity.identity.ownerUserId
    ? await deps.externalResources.listConnectionsByUser(identity.identity.ownerUserId)
    : await deps.externalResources.listConnectionsByOrganizations([identity.identity.ownerOrganizationId!])
  const activeConnections = connections.filter((connection) => connection.status === 'active')
  const grants = await deps.externalResources.listActiveGrantsByAgent(principal.identityId)
  const configuredResources = await deps.authorization.listEnabledResources()
  const visibleResourceIds = new Set([
    ...activeConnections.map((connection) => connection.resourceId),
    ...configuredResources.map((resource) => resource.id),
  ])
  const resources = []
  for (const resourceId of visibleResourceIds) {
    const resource = await deps.authorization.findResource(resourceId)
    const authorization = await findExternalAuthorization(deps, resourceId)
    if (
      !resource?.enabled ||
      resource.archivedAt ||
      (resource.connectorId !== null && authorization?.status !== 'active')
    ) {
      continue
    }
    const scopes = await discoverAgentResourceScopes(deps, resource.resourceUrl)
    resources.push({
      id: resource.id,
      identifier: resource.identifier,
      name: resource.name,
      description: resource.description,
      resourceUrl: resource.resourceUrl,
      connectorId: resource.connectorId,
      status: scopes ? 'available' : 'unavailable',
      scopes: scopes ?? [],
      connections:
        resource.connectorId !== null
          ? activeConnections
              .filter((connection) => connection.resourceId === resourceId)
              .map((connection) => ({
                id: connection.id,
                displayName: connection.displayName,
                subjectHint: redactSubject(connection.externalSubject),
                grantedScopes: connection.grantedScopes.filter(
                  (scope) => scope !== 'openid' && scope !== 'offline_access',
                ),
                authorizationDetails: connection.authorizationDetails,
              }))
          : [],
      grants: grants
        .filter(
          (grant) => grant.resourceId === resourceId && (!grant.expiresAt || grant.expiresAt.getTime() > Date.now()),
        )
        .map(toAgentAccessGrant),
    })
  }
  return { resources }
}

async function discoverAgentResourceScopes(deps: Deps, resourceUrl: string) {
  try {
    return await readDeclaredScopes(deps, resourceUrl)
  } catch {
    return null
  }
}

export async function listAgentApiResources(
  deps: Deps,
  principal: AgentResourcePrincipal,
  pagination: PaginationInput,
) {
  const resources = (await discoverAgentResources(deps, principal)).resources.map((resource) => ({
    id: resource.id,
    identifier: resource.identifier,
    name: resource.name,
    description: resource.description,
    resourceUrl: resource.resourceUrl,
    connectorId: resource.connectorId,
    status: resource.status,
    scopes: resource.scopes,
    accountConnections: resource.connections.map((connection) => ({
      id: connection.id,
      displayName: connection.displayName,
      subjectHint: connection.subjectHint,
      scopes: connection.grantedScopes,
      authorizationDetails: connection.authorizationDetails,
    })),
    accessGrants: resource.grants.map((grant) =>
      toAccessGrant({
        id: grant.id,
        resourceId: grant.resourceId,
        connectionId: grant.connectionId,
        agentIdentityId: grant.agentIdentityId,
        scopes: grant.scopes,
        authorizationDetails: grant.authorizationDetails,
        mode: grant.mode,
        status: grant.status,
        grantedByUserId: grant.grantedByUserId,
        expiresAt: grant.expiresAt ? new Date(grant.expiresAt) : null,
        revokedAt: grant.revokedAt ? new Date(grant.revokedAt) : null,
        createdAt: new Date(grant.createdAt),
        updatedAt: new Date(grant.updatedAt),
      }),
    ),
  }))
  return {
    items: resources.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: paginationMetadata({ ...pagination, total: resources.length }),
  }
}

export async function createAgentAccessRequest(
  deps: Deps,
  input: CreateAgentAccessRequest,
  principal: AgentResourcePrincipal,
  approvalOrigin: string,
) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const resource = await requireEnabledResource(deps, input.resourceId)
  const connection = input.connectionId ? await deps.externalResources.findConnection(input.connectionId) : null
  if (resource.connectorId !== null) {
    if (
      input.connectionId &&
      (!connection || connection.resourceId !== resource.id || connection.status !== 'active')
    ) {
      throw notFound('Active resource account connection was not found.')
    }
    if (connection) {
      assertConnectionInHomeSpace(connection, identity.identity.ownerUserId, identity.identity.ownerOrganizationId)
    }
  } else if (connection) {
    throw badRequest('Native API resources do not use account connections.')
  }
  await validateRequestedScopes(deps, resource.resourceUrl, input.scopes)
  const authorizationDetails = input.authorizationDetails ?? []
  assertAccessRequestAuthorizationDetails(resource, authorizationDetails)
  await requireAgentScopeEligibility(
    deps,
    principal.identityId,
    resource.id,
    identity.identity.ownerOrganizationId,
    input.scopes,
  )
  const scopes = [...new Set(input.scopes)].sort()
  const existingGrant = (await deps.externalResources.listActiveGrantsByAgent(principal.identityId)).find(
    (grant) =>
      grant.connectionId === (connection?.id ?? null) &&
      grant.resourceId === resource.id &&
      exactScopes(grant.scopes, scopes) &&
      exactAuthorizationDetails(grant.authorizationDetails, authorizationDetails) &&
      (!grant.expiresAt || grant.expiresAt.getTime() > Date.now()),
  )
  const binding = identity.bindings.find(
    (candidate) => candidate.hostId === principal.hostId && candidate.protocolAgentId === principal.protocolAgentId,
  )!
  const now = new Date()
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
  const requestId = createId('accessreq')
  const request: AgentAccessRequestRecord = {
    id: requestId,
    resourceId: resource.id,
    connectionId: connection?.id ?? null,
    agentIdentityId: principal.identityId,
    bindingId: binding.id,
    scopes,
    authorizationDetails,
    reason: input.reason ?? null,
    status: existingGrant ? 'approved' : 'pending',
    approvalTokenHash: await sha256(rawApprovalToken),
    encryptedApprovalToken: await deps.secrets.seal(rawApprovalToken, accessRequestTokenContext(requestId)),
    grantId: existingGrant?.id ?? null,
    expiresAt,
    decidedAt: existingGrant ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  const created = await deps.externalResources.createAccessRequest(request)
  if (!created) throw forbidden('Enabled API resource is required.')
  await appendResourceAudit(deps, {
    action: 'api_resource.access_requested',
    result: existingGrant ? 'allowed' : 'pending',
    principal,
    resourceId: resource.id,
    connection,
    grantId: existingGrant?.id ?? null,
    scopes,
    authorizationDetails,
    reasonCode: null,
  })
  return toAgentAccessRequest(
    created,
    principal.hostId,
    existingGrant ? null : approvalUrl(approvalOrigin, rawApprovalToken),
  )
}

export async function createAccessRequest(
  deps: Deps,
  input: CreateAccessRequest,
  principal: AgentResourcePrincipal,
  approvalOrigin: string,
): Promise<AccessRequest> {
  if (input.target.type !== 'api-resource') throw badRequest('Unsupported access request target.')
  return toAccessRequest(
    await createAgentAccessRequest(
      deps,
      {
        resourceId: input.target.apiResourceId,
        connectionId: input.target.accountConnectionId ?? null,
        scopes: input.scopes,
        authorizationDetails: input.authorizationDetails ?? [],
        reason: input.reason,
      },
      principal,
      approvalOrigin,
    ),
  )
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
): Promise<AccessRequest> {
  return toAccessRequest(await getAgentAccessRequest(deps, requestId, principal))
}

export async function listControllerAccessRequests(deps: Deps, actorUserId: string) {
  const connections = await deps.externalResources.listConnectionsByUser(actorUserId)
  const connectionIds = new Set(connections.map((connection) => connection.id))
  const requests = (await deps.externalResources.listPendingAccessRequests()).filter(
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
  const requests = (await listControllerAccessRequests(deps, actorUserId)).requests.map(toAccessRequest)
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
  if (request.target.type !== 'api-resource') throw notFound('Agent access request was not found.')
  const [identity, resource] = await Promise.all([
    deps.agentIdentities.findIdentity(request.agentId),
    deps.authorization.findResource(request.target.apiResourceId),
  ])
  if (!identity) throw notFound('Agent identity was not found.')
  if (!resource) throw notFound('API resource was not found.')
  return {
    ...request,
    agent: { id: identity.identity.id, name: identity.identity.name },
    resource: { id: resource.id, name: resource.name },
  }
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
    const decided = await deps.externalResources.decideAccessRequest(request.id, {
      status: 'denied',
      grantId: null,
      decidedAt: now,
      updatedAt: now,
    })
    if (!decided) throw badRequest('Agent access request was already decided.')
    await appendResourceAudit(deps, {
      action: 'api_resource.access_decided',
      result: 'denied',
      resourceId: request.resourceId,
      connection: controlledConnection,
      request,
      grantId: null,
      controllerUserId: actorUserId,
      scopes: request.scopes,
      authorizationDetails: request.authorizationDetails,
      reasonCode: 'controller_denied',
    })
    return toAgentAccessRequest(decided, await requestHostId(deps, request), null)
  }

  const resource = await requireEnabledResource(deps, request.resourceId)
  const authorizationDetails = input.authorizationDetails ?? []
  if (!exactAuthorizationDetails(authorizationDetails, request.authorizationDetails)) {
    throw invalidAuthorizationDetails('Approved authorization details do not match the pending access request.')
  }
  await validateRequestedScopes(deps, resource.resourceUrl, request.scopes)
  const requestIdentity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
  if (!requestIdentity) throw notFound('Active Agent identity was not found.')
  await requireAgentScopeEligibility(
    deps,
    request.agentIdentityId,
    resource.id,
    requestIdentity.identity.ownerOrganizationId,
    request.scopes,
  )
  const connectionId = input.accountConnectionId ?? request.connectionId
  let connection: ResourceAccountConnectionRecord | null = null
  if (resource.connectorId !== null) {
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
  } else if (connectionId) {
    throw badRequest('Native API resources do not use account connections.')
  } else {
    assertAuthorizationDetailsSelection(resource, null, authorizationDetails)
  }
  const expiresAt = input.mode === 'until' ? new Date(input.expiresAt!) : null
  if (expiresAt && expiresAt.getTime() <= now.getTime()) throw badRequest('Grant expiry must be in the future.')
  const grant = await deps.externalResources.createGrant({
    id: createId('accessgrant'),
    resourceId: request.resourceId,
    connectionId,
    agentIdentityId: request.agentIdentityId,
    scopes: request.scopes,
    authorizationDetails,
    mode: input.mode!,
    status: 'active',
    grantedByUserId: actorUserId,
    expiresAt,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  if (!grant) throw badRequest('The API resource was archived before access could be approved.')
  const decided = await deps.externalResources.decideAccessRequest(request.id, {
    status: 'approved',
    grantId: grant.id,
    connectionId,
    decidedAt: now,
    updatedAt: now,
  })
  if (!decided) throw badRequest('Agent access request was already decided.')
  await appendResourceAudit(deps, {
    action: 'api_resource.access_decided',
    result: 'allowed',
    resourceId: request.resourceId,
    connection,
    request,
    grantId: grant.id,
    controllerUserId: actorUserId,
    scopes: request.scopes,
    authorizationDetails,
    reasonCode: null,
  })
  return toAgentAccessRequest(decided, await requestHostId(deps, request), null)
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
  grantId: string,
  dpopProof: string,
  tokenRequestUrl: string,
  principal: AgentResourcePrincipal,
  signer: AgentAssertionSigner,
) {
  const identity = await requireActiveIdentityAndBinding(deps, principal)
  const grant = await deps.externalResources.findGrant(grantId)
  if (!grant || grant.agentIdentityId !== principal.identityId)
    throw forbidden('Active Agent access grant is required.')
  const request = await deps.externalResources.findAccessRequestByGrant(grant.id)
  if (!request) throw forbidden('Approved Agent access request is required.')
  const resource = await deps.authorization.findResource(request.resourceId)
  if (grant.status !== 'active' || (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) || !resource?.enabled) {
    throw forbidden('Active Agent access grant is required.')
  }
  await validateRequestedScopes(deps, resource.resourceUrl, grant.scopes)
  const roleAuthorization = await requireAgentScopeEligibility(
    deps,
    principal.identityId,
    resource.id,
    identity.identity.ownerOrganizationId,
    grant.scopes,
  )
  if (!exactAuthorizationDetails(grant.authorizationDetails, request.authorizationDetails)) {
    throw forbidden('Agent access grant authorization details do not match the approved request.')
  }
  if (resource.connectorId === null) {
    assertAuthorizationDetailsSelection(resource, null, grant.authorizationDetails)
    return issueNativeAccessToken(
      deps,
      { grant, request, resource, identity, roleAuthorization },
      dpopProof,
      tokenRequestUrl,
      principal,
      signer,
    )
  }

  const [connection, authorization] = await Promise.all([
    request.connectionId ? deps.externalResources.findConnection(request.connectionId) : null,
    findExternalAuthorization(deps, request.resourceId),
  ])
  if (!connection || connection.status !== 'active' || authorization?.status !== 'active') {
    throw forbidden('Active external API resource grant is required.')
  }
  assertScopeSubset(grant.scopes, connection.grantedScopes, 'connected account')
  assertAuthorizationDetailsSelection(resource, connection, grant.authorizationDetails)
  assertAuthorizationDetailsSubset(grant.authorizationDetails, connection.authorizationDetails, 'connected account')
  const confirmationJkt = await dpopThumbprint(deps, dpopProof, authorization.tokenEndpoint)
  const subjectToken = await refreshConnectionToken(deps, connection, authorization)
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
  const token = await postForm(
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
      ...(grant.authorizationDetails.length > 0
        ? { authorization_details: JSON.stringify(grant.authorizationDetails) }
        : {}),
    },
    authorization.clientId,
    clientSecret,
    new Headers({ dpop: dpopProof }),
  )
  const accessToken = requiredString(token, 'access_token', 'Token exchange response')
  if (String(token.token_type).toLowerCase() !== 'dpop') {
    throw unauthorized('Target authorization server did not issue a DPoP-bound access token.')
  }
  const expiresIn = Math.min(requiredPositiveInteger(token, 'expires_in', 'Token exchange response'), 3600)
  const issuedScope = scopeString(token.scope) ?? request.scopes
  if (!exactScopes(issuedScope, request.scopes)) {
    throw unauthorized('Target authorization server issued a different scope set.')
  }
  const issuedAuthorizationDetails = readAuthorizationDetails(
    token.authorization_details,
    grant.authorizationDetails.length > 0,
    grant.authorizationDetails.map((detail) => detail.type),
    'Token exchange response',
  )
  if (!exactAuthorizationDetails(issuedAuthorizationDetails, grant.authorizationDetails)) {
    throw unauthorized('Target authorization server issued different authorization details.')
  }
  const now = new Date()
  const leaseId = createId('tokenlease')
  const lease = await deps.externalResources.createTokenLease({
    id: leaseId,
    grantId: grant.id,
    requestId: request.id,
    bindingId: identity.bindings.find(
      (binding) => binding.protocolAgentId === principal.protocolAgentId && binding.hostId === principal.hostId,
    )!.id,
    encryptedAccessToken: await deps.secrets.seal(accessToken, tokenLeaseContext(leaseId)),
    tokenHash: await sha256(accessToken),
    confirmationJkt,
    scopes: request.scopes,
    authorizationDetails: grant.authorizationDetails,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    revokedAt: null,
    createdAt: now,
  })
  if (!lease) throw forbidden('Active Agent access grant is required.')
  await deps.externalResources.consumeAccessRequest(request.id, now)
  if (grant.mode === 'once') await deps.externalResources.consumeGrant(grant.id, now)
  await appendResourceAudit(deps, {
    action: 'api_resource.token_issued',
    result: 'allowed',
    principal,
    resourceId: resource.id,
    connection,
    request,
    grantId: grant.id,
    scopes: request.scopes,
    authorizationDetails: grant.authorizationDetails,
    reasonCode: null,
  })
  return {
    accessToken,
    tokenType: 'DPoP' as const,
    expiresIn,
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    scopes: request.scopes,
    authorizationDetails: grant.authorizationDetails,
    resourceUrl: resource.resourceUrl,
  }
}

async function issueNativeAccessToken(
  deps: Deps,
  context: {
    grant: AgentAccessGrantRecord
    request: AgentAccessRequestRecord
    resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>
    identity: Awaited<ReturnType<typeof requireActiveIdentityAndBinding>>
    roleAuthorization: Awaited<ReturnType<typeof getAgentRoleAuthorization>>
  },
  dpopProof: string,
  tokenRequestUrl: string,
  principal: AgentResourcePrincipal,
  signer: AgentAssertionSigner,
) {
  const { grant, request, resource, identity, roleAuthorization } = context
  if (request.connectionId !== null || grant.connectionId !== null) {
    throw forbidden('Native API resource grants cannot use account connections.')
  }
  if (signer.issuer !== principal.issuer) {
    throw forbidden('Agent identity does not belong to the active OAuth issuer.')
  }
  const confirmationJkt = await dpopThumbprint(deps, dpopProof, tokenRequestUrl)
  const now = new Date()
  const maximumExpiresAt = new Date(now.getTime() + 5 * 60 * 1000)
  const expiresAt =
    grant.expiresAt && grant.expiresAt.getTime() < maximumExpiresAt.getTime() ? grant.expiresAt : maximumExpiresAt
  const subject = identity.identity.ownerUserId ?? identity.identity.ownerOrganizationId
  if (!subject) throw forbidden('Agent home-space controller is unavailable.')
  const accessToken = await signer.sign(
    {
      iss: signer.issuer,
      sub: subject,
      aud: resource.resourceUrl,
      jti: createId('resat'),
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      scope: request.scopes.join(' '),
      groups: identity.identity.ownerOrganizationId ? [identity.identity.ownerOrganizationId] : [],
      roles: roleAuthorization.roles,
      client_id: principal.protocolAgentId,
      cnf: { jkt: confirmationJkt },
      act: {
        iss: principal.issuer,
        sub: principal.subject,
        sub_profile: 'ai_agent',
      },
    },
    'at+jwt',
  )
  const leaseId = createId('tokenlease')
  const lease = await deps.externalResources.createTokenLease({
    id: leaseId,
    grantId: grant.id,
    requestId: request.id,
    bindingId: identity.bindings.find(
      (binding) => binding.protocolAgentId === principal.protocolAgentId && binding.hostId === principal.hostId,
    )!.id,
    encryptedAccessToken: await deps.secrets.seal(accessToken, tokenLeaseContext(leaseId)),
    tokenHash: await sha256(accessToken),
    confirmationJkt,
    scopes: request.scopes,
    authorizationDetails: [],
    expiresAt,
    revokedAt: null,
    createdAt: now,
  })
  if (!lease) throw forbidden('Active Agent access grant is required.')
  await deps.externalResources.consumeAccessRequest(request.id, now)
  if (grant.mode === 'once') await deps.externalResources.consumeGrant(grant.id, now)
  await appendResourceAudit(deps, {
    action: 'api_resource.token_issued',
    result: 'allowed',
    principal,
    resourceId: resource.id,
    connection: null,
    request,
    grantId: grant.id,
    scopes: request.scopes,
    authorizationDetails: [],
    reasonCode: null,
  })
  return {
    accessToken,
    tokenType: 'DPoP' as const,
    expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    expiresAt: expiresAt.toISOString(),
    scopes: request.scopes,
    authorizationDetails: [],
    resourceUrl: resource.resourceUrl,
  }
}

export async function listAgentAccessGrants(
  deps: Deps,
  principal: AgentResourcePrincipal,
  pagination: PaginationInput,
) {
  await requireActiveIdentityAndBinding(deps, principal)
  const grants = (await deps.externalResources.listActiveGrantsByAgent(principal.identityId)).map(toAccessGrant)
  return {
    items: grants.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: paginationMetadata({ ...pagination, total: grants.length }),
  }
}

export async function getAgentAccessGrant(
  deps: Deps,
  grantId: string,
  principal: AgentResourcePrincipal,
): Promise<AccessGrant> {
  await requireActiveIdentityAndBinding(deps, principal)
  const grant = await deps.externalResources.findGrant(grantId)
  if (!grant || grant.agentIdentityId !== principal.identityId) throw notFound('Agent access grant was not found.')
  return toAccessGrant(grant)
}

export async function revokeAgentAccessGrant(deps: Deps, grantId: string, actorUserId: string) {
  const grant = await deps.externalResources.findGrant(grantId)
  if (!grant) throw notFound('Agent access grant was not found.')
  const request = await deps.externalResources.findAccessRequestByGrant(grant.id)
  if (!request) throw notFound('Approved Agent access request was not found.')
  const connection = await requireControlledRequestTarget(deps, request, actorUserId)
  const now = new Date()
  await revokeGrantTokenLeases(deps, grant, now)
  if (grant.status === 'active') await deps.externalResources.revokeGrant(grant.id, now)
  await appendResourceAudit(deps, {
    action: 'api_resource.access_revoked',
    result: 'allowed',
    resourceId: grant.resourceId,
    connection,
    grantId: grant.id,
    controllerUserId: actorUserId,
    scopes: grant.scopes,
    authorizationDetails: grant.authorizationDetails,
    reasonCode: null,
  })
}

export async function revokeAgentResourceAccess(deps: Deps, agentIdentityId: string) {
  const now = new Date()
  for (const grant of await deps.externalResources.listActiveGrantsByAgent(agentIdentityId)) {
    await revokeGrantTokenLeases(deps, grant, now)
    await deps.externalResources.revokeGrant(grant.id, now)
  }
}

export async function revokeAgentResourceLeasesForBinding(deps: Deps, bindingId: string) {
  const now = new Date()
  for (const lease of await deps.externalResources.listActiveTokenLeasesByBinding(bindingId, now)) {
    const grant = await deps.externalResources.findGrant(lease.grantId)
    if (!grant) continue
    await revokeTokenLeaseAtTarget(deps, grant.resourceId, lease, now)
  }
}

async function revokeGrantTokenLeases(deps: Deps, grant: AgentAccessGrantRecord, now: Date) {
  for (const lease of await deps.externalResources.listActiveTokenLeasesByGrant(grant.id, now)) {
    await revokeTokenLeaseAtTarget(deps, grant.resourceId, lease, now)
  }
}

async function revokeTokenLeaseAtTarget(
  deps: Deps,
  resourceId: string,
  lease: Awaited<ReturnType<Deps['externalResources']['listActiveTokenLeasesByGrant']>>[number],
  now: Date,
) {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource) throw notFound('API resource was not found.')
  if (resource.connectorId === null) {
    await deps.externalResources.revokeTokenLease(lease.id, now)
    return
  }
  const authorization = await requireActiveExternalAuthorization(deps, resourceId)
  const clientSecret = authorizationClientSecret(authorization)
  const token = await deps.secrets.open(lease.encryptedAccessToken, tokenLeaseContext(lease.id))
  await postEmptyForm(
    deps,
    authorization.revocationEndpoint,
    { token, token_type_hint: 'access_token' },
    authorization.clientId,
    clientSecret,
  )
  await deps.externalResources.revokeTokenLease(lease.id, now)
}

async function refreshConnectionToken(
  deps: Deps,
  connection: ResourceAccountConnectionRecord,
  authorization: ExternalResourceAuthorizationRecord,
) {
  const payload = JSON.parse(
    await deps.secrets.open(connection.encryptedTokens, connectionTokensContext(connection.id)),
  ) as Record<string, unknown>
  if (connection.credentialExpiresAt && connection.credentialExpiresAt.getTime() > Date.now() + 30_000) {
    return requiredString(payload, 'accessToken', 'Stored resource connection')
  }
  const refreshToken = requiredString(payload, 'refreshToken', 'Stored resource connection')
  const clientSecret = authorizationClientSecret(authorization)
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
  const now = new Date()
  await deps.externalResources.updateConnectionTokens(connection.id, {
    encryptedTokens: await deps.secrets.seal(
      JSON.stringify({ accessToken, refreshToken: nextRefreshToken, scope: scopes.join(' ') }),
      connectionTokensContext(connection.id),
    ),
    credentialExpiresAt: tokenExpiry(token, now),
    updatedAt: now,
  })
  return accessToken
}

async function dpopThumbprint(deps: Deps, proof: string, tokenEndpoint: string) {
  const header = decodeProtectedHeader(proof)
  if (header.typ?.toLowerCase() !== 'dpop+jwt' || !header.alg || header.alg === 'none' || !header.jwk) {
    throw badRequest('A public-key DPoP proof is required.')
  }
  let payload: Record<string, unknown>
  try {
    const key = await importJWK(header.jwk as JWK, header.alg)
    const verified = await compactVerify(proof, key)
    payload = JSON.parse(new TextDecoder().decode(verified.payload)) as Record<string, unknown>
  } catch {
    throw badRequest('DPoP proof signature is invalid.')
  }
  if (payload.htm !== 'POST' || payload.htu !== tokenEndpoint || typeof payload.jti !== 'string') {
    throw badRequest('DPoP proof is not bound to the target token endpoint.')
  }
  if (typeof payload.iat !== 'number' || Math.abs(Date.now() / 1000 - payload.iat) > 300) {
    throw badRequest('DPoP proof is outside the accepted time window.')
  }
  const thumbprint = await calculateJwkThumbprint(header.jwk as JWK)
  if (
    !(await deps.agentTokens.consumeDpopJti({
      jtiHash: await sha256(payload.jti),
      keyThumbprint: thumbprint,
      expiresAt: new Date((payload.iat + 300) * 1000),
      createdAt: new Date(),
    }))
  ) {
    throw badRequest('DPoP proof was already used.')
  }
  return thumbprint
}

async function requirePendingAccessRequestByToken(deps: Deps, token: string) {
  const request = await deps.externalResources.findAccessRequestByApprovalTokenHash(await sha256(token))
  if (!request || request.status !== 'pending' || request.expiresAt.getTime() <= Date.now()) {
    throw notFound('Pending Agent access request was not found.')
  }
  return request
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
  if (!resource?.connectorId) throw notFound('External API resource was not found.')
  return resource
}

async function requireActiveExternalAuthorization(deps: Deps, resourceId: string) {
  const authorization = await findExternalAuthorization(deps, resourceId)
  if (!authorization || authorization.status !== 'active') {
    throw notFound('Active external API resource authorization was not found.')
  }
  return authorization
}

async function findExternalAuthorization(
  deps: Deps,
  resourceId: string,
): Promise<ResolvedExternalAuthorization | null> {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource?.connectorId) return null
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
    registrationEndpoint: connector.registrationEndpoint,
    revocationEndpoint: connector.revocationEndpoint,
    jwksUri: connector.jwksEndpoint,
    userInfoEndpoint: connector.userInfoEndpoint,
    registrationMode: connector.registrationMode ?? 'manual',
    clientId: connector.clientId,
    encryptedClientSecret: connector.clientSecret,
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

async function requireEnabledResource(deps: Deps, resourceId: string) {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource?.enabled || resource.archivedAt) throw notFound('Enabled API resource was not found.')
  if (resource.connectorId !== null) {
    await requireActiveExternalAuthorization(deps, resourceId)
  }
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
    const member = await deps.authorization.findMemberByOrganizationUser(connection.ownerOrganizationId, actorUserId)
    if (member?.role === 'owner' || member?.role === 'admin' || member?.role === 'credential_manager') {
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
  const member = await deps.authorization.findMemberByOrganizationUser(
    identity.identity.ownerOrganizationId,
    actorUserId,
  )
  return member?.role === 'owner' || member?.role === 'admin'
}

async function requireConnectionOwnerControl(
  deps: Deps,
  owner: CreateResourceConnectionIntentRequest['owner'],
  actorUserId: string,
) {
  if (owner.type === 'user') return
  const member = await deps.authorization.findMemberByOrganizationUser(owner.organizationId, actorUserId)
  if (member?.role !== 'owner' && member?.role !== 'admin' && member?.role !== 'credential_manager') {
    throw forbidden('Organization credential manager access is required.')
  }
}

function assertConnectionInHomeSpace(
  connection: ResourceAccountConnectionRecord,
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

async function appendResourceAudit(
  deps: Deps,
  input: {
    action: string
    result: string
    principal?: AgentResourcePrincipal
    request?: AgentAccessRequestRecord
    resourceId: string
    connection: ResourceAccountConnectionRecord | null
    grantId: string | null
    controllerUserId?: string
    scopes: string[]
    authorizationDetails?: AuthorizationDetail[]
    reasonCode: string | null
  },
) {
  const authorizationDetails =
    input.authorizationDetails ?? input.request?.authorizationDetails ?? input.connection?.authorizationDetails ?? []
  const authorizationDetailProjections = authorizationDetails.map((detail) => ({
    type: detail.type,
    ...(typeof detail.identifier === 'string' ? { identifier: detail.identifier } : {}),
  }))
  await deps.agentAudit.append({
    id: createId('agaudit'),
    action: input.action,
    result: input.result,
    controllerUserId: input.controllerUserId ?? null,
    subjectIssuer: input.principal?.issuer ?? null,
    subject: input.principal?.subject ?? null,
    agentIdentityId: input.principal?.identityId ?? input.request?.agentIdentityId ?? null,
    hostId: input.principal?.hostId ?? null,
    resourceId: input.resourceId,
    resourceConnectionId: input.connection?.id ?? null,
    accessGrantId: input.grantId,
    scopes: input.scopes,
    reasonCode: input.reasonCode,
    metadata:
      authorizationDetailProjections.length > 0 ? { authorizationDetails: authorizationDetailProjections } : null,
    occurredAt: new Date(),
  })
}

async function revokeUncoveredGrants(
  deps: Deps,
  connection: ResourceAccountConnectionRecord,
  authorizationDetailsRequired: boolean,
  controllerUserId: string,
  now: Date,
) {
  for (const grant of await deps.externalResources.listActiveGrantsByConnection(connection.id)) {
    const covered =
      (!authorizationDetailsRequired || grant.authorizationDetails.length > 0) &&
      isAuthorizationDetailsSubset(grant.authorizationDetails, connection.authorizationDetails)
    if (covered) continue
    await revokeGrantTokenLeases(deps, grant, now)
    await deps.externalResources.revokeGrant(grant.id, now)
    await appendResourceAudit(deps, {
      action: 'api_resource.access_revoked',
      result: 'allowed',
      resourceId: grant.resourceId,
      connection,
      grantId: grant.id,
      controllerUserId,
      scopes: grant.scopes,
      authorizationDetails: grant.authorizationDetails,
      reasonCode: 'connection_authorization_changed',
    })
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
  connection: ResourceAccountConnectionRecord | null,
  authorizationDetails: AuthorizationDetail[],
) {
  if (resource.connectorId === null) {
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
    throw invalidAuthorizationDetails('Select at least one granted authorization detail entry.')
  }
}

function assertAccessRequestAuthorizationDetails(
  resource: NonNullable<Awaited<ReturnType<Deps['authorization']['findResource']>>>,
  authorizationDetails: AuthorizationDetail[],
) {
  if (resource.connectorId === null) {
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
    throw invalidAuthorizationDetails('Select at least one authorization detail entry.')
  }
  if (authorizationDetails.some((detail) => !supportedTypes.has(detail.type))) {
    throw invalidAuthorizationDetails('Requested authorization details contain an unsupported type.')
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

function exactAuthorizationDetails(left: AuthorizationDetail[], right: AuthorizationDetail[]) {
  if (left.length !== right.length) return false
  const leftEntries = left.map(canonicalJson).sort()
  const rightEntries = right.map(canonicalJson).sort()
  return leftEntries.every((value, index) => value === rightEntries[index])
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
) {
  const headers = new Headers(extraHeaders)
  headers.set('accept', 'application/json')
  headers.set('authorization', `Basic ${base64(`${clientId}:${clientSecret}`)}`)
  headers.set('content-type', 'application/x-www-form-urlencoded')
  const response = await deps.externalHttp.fetch(
    new Request(url, { method: 'POST', headers, body: new URLSearchParams(body) }),
  )
  if (!response.ok) {
    const detail = await oauthErrorDetail(response)
    throw unauthorized(
      detail
        ? `External authorization server rejected the token request: ${detail}.`
        : 'External authorization server rejected the token request.',
    )
  }
  return readObject(response, 'External authorization server response is invalid.')
}

async function oauthErrorDetail(response: Response): Promise<string | null> {
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
    return description ? `${error}: ${description}` : error
  } catch {
    return null
  }
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
  const response = await deps.externalHttp.fetch(
    new Request(url, { method: 'POST', headers, body: new URLSearchParams(body) }),
  )
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
  if (requested.some((scope) => !allowed.includes(scope))) {
    throw badRequest(`Requested scope exceeds the ${boundary} boundary.`)
  }
}

async function requireAgentScopeEligibility(
  deps: Deps,
  agentIdentityId: string,
  resourceId: string,
  organizationId: string | null,
  scopes: string[],
) {
  const authorization = await getAgentRoleAuthorization(deps, agentIdentityId, resourceId, organizationId ?? undefined)
  if (authorization.roles.length > 0 && scopes.some((scope) => !authorization.scopes.includes(scope))) {
    throw forbidden('Agent roles do not permit every requested scope.')
  }
  return authorization
}

function exactScopes(left: string[], right: string[]) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])
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

function toResourceConnection(record: ResourceAccountConnectionRecord) {
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
    status: record.status as 'active' | 'revoked',
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
    grantId: record.grantId,
    expiresAt: record.expiresAt.toISOString(),
    decidedAt: record.decidedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function toAgentAccessGrant(record: AgentAccessGrantRecord) {
  return {
    id: record.id,
    resourceId: record.resourceId,
    connectionId: record.connectionId,
    agentIdentityId: record.agentIdentityId,
    scopes: record.scopes,
    authorizationDetails: record.authorizationDetails,
    mode: record.mode as 'once' | 'until' | 'persistent',
    status: record.status as 'active' | 'revoked' | 'consumed' | 'expired',
    grantedByUserId: record.grantedByUserId,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function toAccountConnection(record: ResourceAccountConnectionRecord): AccountConnection {
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
    status: record.status as 'active' | 'revoked',
    credentialExpiresAt: record.credentialExpiresAt?.toISOString() ?? null,
    authorizationUrl: null,
    expiresAt: null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
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
): AccessRequest {
  return {
    id: request.id,
    agentId: request.agentIdentityId,
    target: {
      type: 'api-resource',
      apiResourceId: request.resourceId,
      ...(request.connectionId ? { accountConnectionId: request.connectionId } : {}),
    },
    scopes: request.scopes,
    authorizationDetails: request.authorizationDetails,
    reason: request.reason,
    status: request.status,
    approval: request.approvalUrl
      ? {
          url: request.approvalUrl,
          expiresAt: request.expiresAt,
        }
      : null,
    grantId: request.grantId,
    expiresAt: request.expiresAt,
    decidedAt: request.decidedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

function toAccessGrant(record: AgentAccessGrantRecord): AccessGrant {
  return {
    id: record.id,
    agentId: record.agentIdentityId,
    target: {
      type: 'api-resource',
      apiResourceId: record.resourceId,
      ...(record.connectionId ? { accountConnectionId: record.connectionId } : {}),
    },
    scopes: record.scopes,
    authorizationDetails: record.authorizationDetails,
    mode: record.mode as AccessGrant['mode'],
    status: record.status as AccessGrant['status'],
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function redactSubject(subject: string) {
  return subject.length <= 4 ? '••••' : `••••${subject.slice(-4)}`
}

function resourceConnectionCallbackUrl(origin: string) {
  return `${origin.replace(/\/$/, '')}/api/account-connections/oauth/callback`
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

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

import { badRequest, forbidden, notFound, unauthorized } from '@server/domain/errors'
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
  AccountConnection,
  ApiResource,
  CreateAccessRequest,
  CreateAccountConnection,
} from '@shared/api/agent-api'
import type {
  ConfigureExternalResourceAuthorizationRequest,
  CreateAgentAccessRequest,
  CreateResourceConnectionIntentRequest,
  DecideAgentAccessRequest,
} from '@shared/api/external-resources'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'
import { calculateJwkThumbprint, compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose'
import { getAgentRoleAuthorization } from './authorization'
import { readDeclaredScopes, validateRequestedScopes, validateResourceContract } from './resource-openapi'

const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
const jwtBearerGrantType = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'
const page = { limit: 100, offset: 0 }

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

export async function configureExternalResourceAuthorization(
  deps: Deps,
  resourceId: string,
  input: ConfigureExternalResourceAuthorizationRequest,
  callbackOrigin: string,
) {
  const resource = await requireExternalResource(deps, resourceId)
  const resourceUrl = requireNetworkUrl(resource.resourceUrl, 'resource URL')
  await validateResourceContract(deps, resourceUrl)
  const protectedMetadata = await fetchObject(
    deps,
    protectedResourceMetadataUrl(resourceUrl),
    'Protected resource metadata discovery failed.',
  )
  if (protectedMetadata.resource !== resourceUrl) {
    throw badRequest('Protected resource metadata does not match the configured resource URL.')
  }
  const authorizationServers = stringArray(protectedMetadata.authorization_servers)
  if (authorizationServers.length !== 1) {
    throw badRequest('External API resource must advertise exactly one authorization server.')
  }
  const issuer = requireNetworkUrl(authorizationServers[0]!, 'authorization server issuer').replace(/\/$/, '')
  const metadata = await fetchObject(
    deps,
    authorizationServerMetadataUrl(issuer),
    'Authorization server metadata discovery failed.',
  )
  if (metadata.issuer !== issuer) {
    throw badRequest('Authorization server metadata issuer does not match the protected resource.')
  }

  const authorizationEndpoint = requiredMetadataUrl(metadata, 'authorization_endpoint')
  const tokenEndpoint = requiredMetadataUrl(metadata, 'token_endpoint')
  const revocationEndpoint = requiredMetadataUrl(metadata, 'revocation_endpoint')
  const jwksUri = requiredMetadataUrl(metadata, 'jwks_uri')
  const userInfoEndpoint = requiredMetadataUrl(metadata, 'userinfo_endpoint')
  const registrationEndpoint =
    typeof metadata.registration_endpoint === 'string'
      ? requireNetworkUrl(metadata.registration_endpoint, 'registration endpoint')
      : null
  const grants = stringArray(metadata.grant_types_supported)
  if (
    !grants.includes('authorization_code') ||
    !grants.includes('refresh_token') ||
    !grants.includes(jwtBearerGrantType) ||
    !grants.includes(tokenExchangeGrantType)
  ) {
    throw badRequest(
      'Authorization server must support authorization_code, refresh_token, the RFC 7523 JWT bearer grant, and RFC 8693 token exchange.',
    )
  }
  if (stringArray(metadata.dpop_signing_alg_values_supported).length === 0) {
    throw badRequest('Authorization server must advertise RFC 9449 DPoP support.')
  }
  let clientId = input.clientId ?? null
  let clientSecret = input.clientSecret ?? null
  let registrationAccessToken: string | null = null
  if (input.registrationMode === 'dynamic') {
    if (!registrationEndpoint) throw badRequest('Authorization server does not support dynamic client registration.')
    const registration = await registerClient(deps, registrationEndpoint, callbackOrigin)
    clientId = registration.clientId
    clientSecret = registration.clientSecret
    registrationAccessToken = registration.registrationAccessToken
  }
  if (!clientId || !clientSecret) throw badRequest('External API resource OAuth client is incomplete.')

  const now = new Date()
  const record: ExternalResourceAuthorizationRecord = {
    resourceId,
    resourceUrl,
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    revocationEndpoint,
    jwksUri,
    userInfoEndpoint,
    registrationMode: input.registrationMode,
    clientId,
    encryptedClientSecret: await deps.secrets.seal(clientSecret, clientSecretContext(resourceId)),
    encryptedRegistrationAccessToken: registrationAccessToken
      ? await deps.secrets.seal(registrationAccessToken, registrationTokenContext(resourceId))
      : null,
    metadata,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  const configured = await deps.externalResources.upsertAuthorization(record)
  await deps.authorization.updateResource(resourceId, { enabled: true })
  return toExternalAuthorization(configured)
}

export async function getExternalResourceAuthorization(deps: Deps, resourceId: string) {
  await requireExternalResource(deps, resourceId)
  const authorization = await deps.externalResources.findAuthorization(resourceId)
  if (!authorization) throw notFound('External API resource authorization was not found.')
  return toExternalAuthorization(authorization)
}

export async function getApiResource(deps: Deps, resourceId: string): Promise<ApiResource> {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource) throw notFound('API resource was not found.')
  const authorization = await deps.externalResources.findAuthorization(resourceId)
  return {
    ...resource,
    authorization: authorization ? omitResourceId(toExternalAuthorization(authorization)) : null,
  }
}

export async function listApiResources(deps: Deps, pagination: PaginationInput) {
  const page = await deps.authorization.listResources(pagination)
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
  const authorization = await requireActiveExternalAuthorization(deps, resourceId)
  await requireConnectionOwnerControl(deps, input.owner, actorUserId)
  const scopes = input.scopes
  await validateRequestedScopes(deps, resource.resourceUrl, scopes)
  const requestedScopes = [...new Set([...scopes, 'openid', 'offline_access'])].sort()
  const id = createId('resconnint')
  const state = randomToken()
  const verifier = randomToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  await deps.externalResources.createConnectionIntent({
    id,
    stateHash: await sha256(state),
    resourceId,
    ownerUserId: actorUserId,
    ownerOrganizationId: input.owner.type === 'organization' ? input.owner.organizationId : null,
    scopes: requestedScopes,
    encryptedPkceVerifier: await deps.secrets.seal(verifier, connectionIntentContext(id)),
    returnTo: input.returnTo ?? 'account-center',
    status: 'pending',
    expiresAt,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  const redirectUri = resourceConnectionCallbackUrl(callbackOrigin)
  const url = new URL(authorization.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', authorization.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('resource', resource.resourceUrl)
  url.searchParams.set('scope', requestedScopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await sha256(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  return {
    id,
    resourceId,
    owner:
      input.owner.type === 'organization'
        ? { type: 'organization' as const, organizationId: input.owner.organizationId }
        : { type: 'user' as const, userId: actorUserId },
    authorizationUrl: url.toString(),
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
  const clientSecret = await deps.secrets.open(
    authorization.encryptedClientSecret,
    clientSecretContext(intent.resourceId),
  )
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
  const connectionId = intent.id
  const grantedScopes = scopeString(token.scope) ?? intent.scopes
  const record: ResourceAccountConnectionRecord = {
    id: connectionId,
    resourceId: intent.resourceId,
    ownerUserId: intent.ownerOrganizationId ? null : intent.ownerUserId,
    ownerOrganizationId: intent.ownerOrganizationId,
    externalSubject,
    displayName,
    encryptedTokens: await deps.secrets.seal(
      JSON.stringify({ accessToken, refreshToken, scope: grantedScopes.join(' ') }),
      connectionTokensContext(connectionId),
    ),
    grantedScopes,
    status: 'active',
    credentialExpiresAt: expiresAt,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  return {
    ...toResourceConnection(await deps.externalResources.createConnection(record)),
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
    if (resource.authorizationMode !== 'external') {
      throw badRequest('Native API resources do not use account connections.')
    }
    const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
    if (!identity) throw notFound('Active Agent identity was not found.')
    const owner = identity.identity.ownerOrganizationId
      ? { type: 'organization' as const, organizationId: identity.identity.ownerOrganizationId }
      : { type: 'user' as const }
    const pending = await createResourceConnectionIntent(
      deps,
      request.resourceId,
      { owner, scopes: request.scopes, returnTo: 'access-approval' },
      actorUserId,
      callbackOrigin,
    )
    return toPendingAccountConnection(pending, request.scopes)
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
  if (resource.authorizationMode !== 'external') {
    return { items: [], pagination: paginationMetadata({ ...pagination, total: 0 }) }
  }
  const identity = await deps.agentIdentities.findIdentity(request.agentIdentityId)
  if (!identity) throw notFound('Active Agent identity was not found.')
  const connections = (
    identity.identity.ownerOrganizationId
      ? await deps.externalResources.listConnectionsByOrganizations([identity.identity.ownerOrganizationId])
      : await deps.externalResources.listConnectionsByUser(identity.identity.ownerUserId!)
  )
    .filter(
      (connection) =>
        connection.resourceId === request.resourceId &&
        connection.status === 'active' &&
        request.scopes.every((scope) => connection.grantedScopes.includes(scope)),
    )
    .map(toAccountConnection)
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
  const resources = (await deps.authorization.listResources(page)).items.filter(
    (resource) => resource.enabled && resource.authorizationMode === 'external',
  )
  const connectable = []
  for (const resource of resources) {
    const authorization = await deps.externalResources.findAuthorization(resource.id)
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
  const configuredResources = (await deps.authorization.listResources(page)).items.filter(
    (resource) => resource.enabled,
  )
  const visibleResourceIds = new Set([
    ...activeConnections.map((connection) => connection.resourceId),
    ...configuredResources.map((resource) => resource.id),
  ])
  const resources = []
  for (const resourceId of visibleResourceIds) {
    const resource = await deps.authorization.findResource(resourceId)
    const authorization = await deps.externalResources.findAuthorization(resourceId)
    if (!resource?.enabled || (resource.authorizationMode === 'external' && authorization?.status !== 'active')) {
      continue
    }
    const scopes = await discoverAgentResourceScopes(deps, resource.resourceUrl)
    resources.push({
      id: resource.id,
      identifier: resource.identifier,
      name: resource.name,
      description: resource.description,
      resourceUrl: resource.resourceUrl,
      authorizationMode: resource.authorizationMode,
      status: scopes ? 'available' : 'unavailable',
      scopes: scopes ?? [],
      connections:
        resource.authorizationMode === 'external'
          ? activeConnections
              .filter((connection) => connection.resourceId === resourceId)
              .map((connection) => ({
                id: connection.id,
                displayName: connection.displayName,
                subjectHint: redactSubject(connection.externalSubject),
                grantedScopes: connection.grantedScopes.filter(
                  (scope) => scope !== 'openid' && scope !== 'offline_access',
                ),
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
    authorizationMode: resource.authorizationMode,
    status: resource.status,
    scopes: resource.scopes,
    accountConnections: resource.connections.map((connection) => ({
      id: connection.id,
      displayName: connection.displayName,
      subjectHint: connection.subjectHint,
      scopes: connection.grantedScopes,
    })),
    accessGrants: resource.grants.map((grant) =>
      toAccessGrant({
        id: grant.id,
        resourceId: grant.resourceId,
        connectionId: grant.connectionId,
        agentIdentityId: grant.agentIdentityId,
        scopes: grant.scopes,
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
  if (resource.authorizationMode === 'external') {
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
  await requireAgentScopeEligibility(
    deps,
    principal.identityId,
    resource.id,
    identity.identity.ownerOrganizationId,
    input.scopes,
  )
  if (connection) assertScopeSubset(input.scopes, connection.grantedScopes, 'connected account')
  const scopes = [...new Set(input.scopes)].sort()
  const existingGrant = (await deps.externalResources.listActiveGrantsByAgent(principal.identityId)).find(
    (grant) =>
      grant.connectionId === (connection?.id ?? null) &&
      grant.resourceId === resource.id &&
      exactScopes(grant.scopes, scopes) &&
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
      exactScopes(request.scopes, scopes),
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
  await appendResourceAudit(deps, {
    action: 'api_resource.access_requested',
    result: existingGrant ? 'allowed' : 'pending',
    principal,
    resourceId: resource.id,
    connection,
    grantId: existingGrant?.id ?? null,
    scopes,
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
    items: requests.slice(pagination.offset, pagination.offset + pagination.limit),
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
): Promise<AccessRequest> {
  return toAccessRequest(await getControllerAccessRequestByToken(deps, approvalToken, actorUserId))
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
      reasonCode: 'controller_denied',
    })
    return toAgentAccessRequest(decided, await requestHostId(deps, request), null)
  }

  const resource = await requireEnabledResource(deps, request.resourceId)
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
  if (resource.authorizationMode === 'external') {
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
  } else if (connectionId) {
    throw badRequest('Native API resources do not use account connections.')
  }
  const expiresAt = input.mode === 'until' ? new Date(input.expiresAt!) : null
  if (expiresAt && expiresAt.getTime() <= now.getTime()) throw badRequest('Grant expiry must be in the future.')
  const grant = await deps.externalResources.createGrant({
    id: createId('accessgrant'),
    resourceId: request.resourceId,
    connectionId,
    agentIdentityId: request.agentIdentityId,
    scopes: request.scopes,
    mode: input.mode!,
    status: 'active',
    grantedByUserId: actorUserId,
    expiresAt,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  })
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
  if (resource.authorizationMode === 'native') {
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
    deps.externalResources.findAuthorization(request.resourceId),
  ])
  if (!connection || connection.status !== 'active' || authorization?.status !== 'active') {
    throw forbidden('Active external API resource grant is required.')
  }
  assertScopeSubset(grant.scopes, connection.grantedScopes, 'connected account')
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
  const clientSecret = await deps.secrets.open(authorization.encryptedClientSecret, clientSecretContext(resource.id))
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
  const now = new Date()
  const leaseId = createId('tokenlease')
  await deps.externalResources.createTokenLease({
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
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    revokedAt: null,
    createdAt: now,
  })
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
    reasonCode: null,
  })
  return {
    accessToken,
    tokenType: 'DPoP' as const,
    expiresIn,
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    scopes: request.scopes,
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
        sub: principal.hostId,
        actor_type: 'host',
        act: {
          iss: principal.issuer,
          sub: principal.subject,
          actor_type: 'agent',
        },
      },
    },
    'at+jwt',
  )
  const leaseId = createId('tokenlease')
  await deps.externalResources.createTokenLease({
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
    expiresAt,
    revokedAt: null,
    createdAt: now,
  })
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
    reasonCode: null,
  })
  return {
    accessToken,
    tokenType: 'DPoP' as const,
    expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    expiresAt: expiresAt.toISOString(),
    scopes: request.scopes,
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
  if (resource.authorizationMode === 'native') {
    await deps.externalResources.revokeTokenLease(lease.id, now)
    return
  }
  const authorization = await requireActiveExternalAuthorization(deps, resourceId)
  const clientSecret = await deps.secrets.open(authorization.encryptedClientSecret, clientSecretContext(resourceId))
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

async function registerClient(deps: Deps, endpoint: string, callbackOrigin: string) {
  const response = await deps.externalHttp.fetch(
    new Request(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Realmroot External API Resource',
        redirect_uris: [resourceConnectionCallbackUrl(callbackOrigin)],
        grant_types: ['authorization_code', 'refresh_token', jwtBearerGrantType, tokenExchangeGrantType],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'openid offline_access',
        jwks_uri: `${callbackOrigin.replace(/\/$/, '')}/api/auth/jwks`,
      }),
    }),
  )
  if (!response.ok) throw badRequest('Dynamic client registration failed.')
  const body = await readObject(response, 'Dynamic client registration response is invalid.')
  return {
    clientId: requiredString(body, 'client_id', 'Dynamic client registration response'),
    clientSecret: requiredString(body, 'client_secret', 'Dynamic client registration response'),
    registrationAccessToken: optionalString(body, 'registration_access_token'),
  }
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
  const clientSecret = await deps.secrets.open(
    authorization.encryptedClientSecret,
    clientSecretContext(connection.resourceId),
  )
  const token = await postForm(
    deps,
    authorization.tokenEndpoint,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    authorization.clientId,
    clientSecret,
  )
  const accessToken = requiredString(token, 'access_token', 'OAuth refresh response')
  const nextRefreshToken = optionalString(token, 'refresh_token') ?? refreshToken
  const scopes = scopeString(token.scope) ?? connection.grantedScopes
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
  if (!resource || resource.authorizationMode !== 'external') throw notFound('External API resource was not found.')
  return resource
}

async function requireActiveExternalAuthorization(deps: Deps, resourceId: string) {
  const authorization = await deps.externalResources.findAuthorization(resourceId)
  if (!authorization || authorization.status !== 'active') {
    throw notFound('Active external API resource authorization was not found.')
  }
  return authorization
}

async function requireEnabledResource(deps: Deps, resourceId: string) {
  const resource = await deps.authorization.findResource(resourceId)
  if (!resource?.enabled) throw notFound('Enabled API resource was not found.')
  if (resource.authorizationMode === 'external') {
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
    reasonCode: string | null
  },
) {
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
    metadata: null,
    occurredAt: new Date(),
  })
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
  if (!response.ok) throw unauthorized('External authorization server rejected the token request.')
  return readObject(response, 'External authorization server response is invalid.')
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

function protectedResourceMetadataUrl(resourceUrl: string) {
  const resource = new URL(resourceUrl)
  const path = resource.pathname === '/' ? '' : resource.pathname
  const metadata = new URL(`/.well-known/oauth-protected-resource${path}`, resource.origin)
  metadata.search = resource.search
  return metadata.toString()
}

function authorizationServerMetadataUrl(issuer: string) {
  const url = new URL(issuer)
  return new URL(
    `/.well-known/oauth-authorization-server${url.pathname === '/' ? '' : url.pathname}`,
    url.origin,
  ).toString()
}

function requiredMetadataUrl(metadata: Record<string, unknown>, field: string) {
  return requireNetworkUrl(requiredString(metadata, field, 'Authorization server metadata'), field)
}

function requireNetworkUrl(value: string, label: string) {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password) {
    throw badRequest(`${label} must use HTTPS, except for loopback development URLs, and contain no userinfo.`)
  }
  return url.toString()
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

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
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
    resourceUrl: record.resourceUrl,
    issuer: record.issuer,
    authorizationEndpoint: record.authorizationEndpoint,
    tokenEndpoint: record.tokenEndpoint,
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
    scopes: record.grantedScopes,
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

function clientSecretContext(resourceId: string) {
  return `external-resource:${resourceId}:client-secret`
}

function registrationTokenContext(resourceId: string) {
  return `external-resource:${resourceId}:registration-token`
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

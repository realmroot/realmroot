import { badRequest, forbidden, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { ExternalAccountRecord, ExternalCredentialRecord } from '@server/usecases/ports'
import type {
  CreateExternalAccountGrantRequest,
  CreateExternalAccountRequest,
  CreateExternalOAuthIntentRequest,
} from '@shared/api/external-accounts'

export async function createExternalAccount(deps: Deps, input: CreateExternalAccountRequest, actorUserId: string) {
  const connector = await deps.connectors.findById(input.connectorId)
  if (!connector?.enabled) throw notFound('Enabled Connector was not found.')
  if (!connector.apiBaseUrl) throw badRequest('Connector is not configured for API brokerage.')
  if (!connector.credentialModes?.includes(input.credential.kind)) {
    throw badRequest('Connector does not accept this credential type.')
  }
  await requireOwnerControl(deps, input.owner, actorUserId)

  const now = new Date()
  const accountId = createId('extacct')
  const account: ExternalAccountRecord = {
    id: accountId,
    connectorId: connector.id,
    ownerUserId: input.owner.type === 'user' ? actorUserId : null,
    ownerOrganizationId: input.owner.type === 'organization' ? input.owner.organizationId : null,
    ownerAgentIdentityId: input.owner.type === 'agent' ? input.owner.agentIdentityId : null,
    externalSubject: null,
    displayName: input.displayName,
    status: 'active',
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }
  const credentialId = createId('extcred')
  const payload =
    input.credential.kind === 'bearer'
      ? { token: input.credential.token }
      : { headerName: connector.credentialHeaderName, value: input.credential.value }
  if (input.credential.kind === 'header' && !connector.credentialHeaderName) {
    throw badRequest('Connector header injection is not configured.')
  }
  const credential: ExternalCredentialRecord = {
    id: credentialId,
    externalAccountId: accountId,
    kind: input.credential.kind,
    encryptedPayload: await deps.secrets.seal(
      JSON.stringify(payload),
      externalCredentialContext(accountId, credentialId),
    ),
    status: 'active',
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  }

  const created = await deps.externalAccounts.createAccountWithCredential(account, credential)
  return toExternalAccount(created.account, created.credential)
}

export async function listExternalAccounts(deps: Deps, actorUserId: string) {
  const identities = await deps.agentIdentities.listPersonal(actorUserId)
  const rows = [
    ...(await deps.externalAccounts.listByOwnerUser(actorUserId)),
    ...(await deps.externalAccounts.listByOwnerAgents(identities.map((identity) => identity.identity.id))),
  ]
  return { externalAccounts: rows.map(({ account, credential }) => toExternalAccount(account, credential)) }
}

export async function createExternalOAuthIntent(
  deps: Deps,
  input: CreateExternalOAuthIntentRequest,
  actorUserId: string,
  issuerOrigin: string,
) {
  const connector = await deps.connectors.findById(input.connectorId)
  if (!connector?.enabled) throw notFound('Enabled Connector was not found.')
  if (connector.providerType !== 'generic_oauth' || !connector.credentialModes?.includes('oauth')) {
    throw badRequest('Connector is not configured for OAuth credential brokerage.')
  }
  if (!connector.clientId || !connector.clientSecret || !connector.apiBaseUrl) {
    throw badRequest('OAuth Connector configuration is incomplete.')
  }
  await requireOwnerControl(deps, input.owner, actorUserId)
  const endpoints = await resolveOAuthEndpoints(deps, connector)
  const id = createId('extoauth')
  const state = randomToken()
  const verifier = randomToken()
  const redirectUri = `${issuerOrigin.replace(/\/$/, '')}/api/external-accounts/oauth/callback`
  const scopes = input.scopes ?? connector.scopes ?? []
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  await deps.externalAccounts.createOAuthIntent({
    id,
    stateHash: await sha256(state),
    connectorId: connector.id,
    ownerUserId: actorUserId,
    agentIdentityId: input.owner.type === 'agent' ? input.owner.agentIdentityId : null,
    ownerOrganizationId: input.owner.type === 'organization' ? input.owner.organizationId : null,
    displayName: input.displayName,
    scopes,
    encryptedPkceVerifier: await deps.secrets.seal(verifier, oauthVerifierContext(id)),
    status: 'pending',
    expiresAt,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const authorizationUrl = new URL(endpoints.authorizationEndpoint)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('client_id', connector.clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('scope', scopes.join(' '))
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('code_challenge', await sha256(verifier))
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  return { authorizationUrl: authorizationUrl.toString(), expiresAt: expiresAt.toISOString() }
}

export async function completeExternalOAuthIntent(
  deps: Deps,
  input: { state: string; code: string },
  issuerOrigin: string,
) {
  const now = new Date()
  const intent = await deps.externalAccounts.consumeOAuthIntent(await sha256(input.state), now)
  if (!intent) throw badRequest('OAuth connection state is invalid, expired, or already used.')
  const connector = await deps.connectors.findById(intent.connectorId)
  if (!connector?.enabled || !connector.clientId || !connector.clientSecret || !connector.apiBaseUrl) {
    throw badRequest('OAuth Connector configuration is unavailable.')
  }
  const endpoints = await resolveOAuthEndpoints(deps, connector)
  const verifier = await deps.secrets.open(intent.encryptedPkceVerifier, oauthVerifierContext(intent.id))
  const redirectUri = `${issuerOrigin.replace(/\/$/, '')}/api/external-accounts/oauth/callback`
  const tokenResponse = await deps.externalHttp.fetch(
    new Request(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${base64(`${connector.clientId}:${connector.clientSecret}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    }),
  )
  if (!tokenResponse.ok) throw badRequest('OAuth token exchange failed.')
  const token = await readObject(tokenResponse, 'OAuth token response is invalid.')
  if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
    throw badRequest('OAuth token response does not contain an access token.')
  }
  const expiresIn =
    typeof token.expires_in === 'number' && Number.isFinite(token.expires_in) && token.expires_in > 0
      ? token.expires_in
      : null
  const expiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null
  const profile = endpoints.userInfoEndpoint
    ? await fetchOAuthProfile(deps, endpoints.userInfoEndpoint, token.access_token)
    : null
  const accountId = createId('extacct')
  const credentialId = createId('extcred')
  const account: ExternalAccountRecord = {
    id: accountId,
    connectorId: connector.id,
    ownerUserId: intent.agentIdentityId || intent.ownerOrganizationId ? null : intent.ownerUserId,
    ownerOrganizationId: intent.ownerOrganizationId,
    ownerAgentIdentityId: intent.agentIdentityId,
    externalSubject: typeof profile?.sub === 'string' ? profile.sub : null,
    displayName: intent.displayName,
    status: 'active',
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }
  const credential: ExternalCredentialRecord = {
    id: credentialId,
    externalAccountId: accountId,
    kind: 'oauth',
    encryptedPayload: await deps.secrets.seal(
      JSON.stringify({
        accessToken: token.access_token,
        refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
        tokenType: typeof token.token_type === 'string' ? token.token_type : 'Bearer',
        scope: typeof token.scope === 'string' ? token.scope : intent.scopes.join(' '),
      }),
      externalCredentialContext(accountId, credentialId),
    ),
    status: 'active',
    expiresAt,
    createdAt: now,
    updatedAt: now,
  }
  const created = await deps.externalAccounts.createAccountWithCredential(account, credential)
  return toExternalAccount(created.account, created.credential)
}

export async function createExternalAccountGrant(
  deps: Deps,
  externalAccountId: string,
  input: CreateExternalAccountGrantRequest,
  actorUserId: string,
) {
  const account = await requireControlledExternalAccount(deps, externalAccountId, actorUserId)
  const identity = await requireControlledAgentIdentity(deps, input.agentIdentityId, actorUserId)
  if (identity.identity.status !== 'active') throw badRequest('Agent identity must be active.')
  const connector = await deps.connectors.findById(account.connectorId)
  if (!connector?.apiBaseUrl) throw badRequest('Connector is not configured for API brokerage.')
  assertSubset(input.allowedMethods, connector.allowedMethods ?? [], 'method')
  assertPathSubset(input.allowedPathPrefixes, connector.allowedPathPrefixes ?? [])
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && expiresAt.getTime() <= Date.now())
    throw badRequest('External account grant expiry must be in the future.')
  if (await deps.externalAccounts.findActiveGrant(externalAccountId, input.agentIdentityId)) {
    throw badRequest('An active grant already exists for this Agent and external account.')
  }
  const now = new Date()
  return toExternalAccountGrant(
    await deps.externalAccounts.createGrant({
      id: createId('extgrant'),
      externalAccountId,
      agentIdentityId: input.agentIdentityId,
      scopes: [...new Set(input.scopes)],
      allowedMethods: [...new Set(input.allowedMethods)],
      allowedPathPrefixes: [...new Set(input.allowedPathPrefixes)],
      status: 'active',
      grantedByUserId: actorUserId,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  )
}

export async function revokeExternalAccountGrant(
  deps: Deps,
  externalAccountId: string,
  grantId: string,
  actorUserId: string,
) {
  await requireControlledExternalAccount(deps, externalAccountId, actorUserId)
  const grant = await deps.externalAccounts.findGrant(grantId)
  if (!grant || grant.externalAccountId !== externalAccountId) throw notFound('External account grant was not found.')
  if (!(await deps.externalAccounts.revokeGrant(grantId, new Date()))) {
    throw badRequest('External account grant is already revoked.')
  }
}

export async function requireControlledExternalAccount(deps: Deps, id: string, actorUserId: string) {
  const account = await deps.externalAccounts.findAccount(id)
  if (!account) throw notFound('External account was not found.')
  if (account.ownerUserId === actorUserId) return account
  if (account.ownerAgentIdentityId) {
    await requireControlledAgentIdentity(deps, account.ownerAgentIdentityId, actorUserId)
    return account
  }
  if (account.ownerOrganizationId) {
    const member = await deps.authorization.findMemberByOrganizationUser(account.ownerOrganizationId, actorUserId)
    if (member?.role === 'owner' || member?.role === 'admin') return account
  }
  throw forbidden('External account controller access is required.')
}

async function requireOwnerControl(
  deps: Deps,
  owner: CreateExternalAccountRequest['owner'] | CreateExternalOAuthIntentRequest['owner'],
  actorUserId: string,
) {
  if (owner.type === 'user') return
  if (owner.type === 'agent') {
    await requireControlledAgentIdentity(deps, owner.agentIdentityId, actorUserId)
    return
  }
  const member = await deps.authorization.findMemberByOrganizationUser(owner.organizationId, actorUserId)
  if (member?.role !== 'owner' && member?.role !== 'admin') {
    throw forbidden('Organization controller access is required.')
  }
}

async function requireControlledAgentIdentity(deps: Deps, id: string, actorUserId: string) {
  const identity = await deps.agentIdentities.findIdentity(id)
  if (!identity) throw notFound('Agent identity was not found.')
  if (identity.identity.ownerUserId === actorUserId) return identity
  if (identity.identity.ownerOrganizationId) {
    const member = await deps.authorization.findMemberByOrganizationUser(
      identity.identity.ownerOrganizationId,
      actorUserId,
    )
    if (member?.role === 'owner' || member?.role === 'admin') return identity
  }
  throw forbidden('Agent identity controller access is required.')
}

function assertSubset(values: string[], allowed: string[], label: string) {
  if (values.some((value) => !allowed.includes(value))) {
    throw badRequest(`External account grant ${label} exceeds the Connector boundary.`)
  }
}

function assertPathSubset(paths: string[], allowedPrefixes: string[]) {
  if (paths.some((path) => !allowedPrefixes.some((prefix) => path.startsWith(prefix)))) {
    throw badRequest('External account grant path exceeds the Connector boundary.')
  }
}

function toExternalAccount(account: ExternalAccountRecord, credential: ExternalCredentialRecord) {
  const owner = account.ownerUserId
    ? { type: 'user' as const, userId: account.ownerUserId }
    : account.ownerOrganizationId
      ? { type: 'organization' as const, organizationId: account.ownerOrganizationId }
      : { type: 'agent' as const, agentIdentityId: account.ownerAgentIdentityId! }
  return {
    id: account.id,
    connectorId: account.connectorId,
    owner,
    externalSubject: account.externalSubject,
    displayName: account.displayName,
    status: account.status as 'active' | 'revoked',
    credentialKind: credential.kind as 'oauth' | 'bearer' | 'header',
    credentialConfigured: true as const,
    credentialExpiresAt: credential.expiresAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  }
}

function toExternalAccountGrant(grant: Awaited<ReturnType<Deps['externalAccounts']['createGrant']>>) {
  return {
    id: grant.id,
    externalAccountId: grant.externalAccountId,
    agentIdentityId: grant.agentIdentityId,
    scopes: grant.scopes,
    allowedMethods: grant.allowedMethods,
    allowedPathPrefixes: grant.allowedPathPrefixes,
    status: grant.status as 'active' | 'revoked',
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  }
}

export function externalCredentialContext(accountId: string, credentialId: string) {
  return `external-account:${accountId}:credential:${credentialId}`
}

export async function resolveOAuthEndpoints(
  deps: Deps,
  connector: Awaited<ReturnType<Deps['connectors']['findById']>>,
) {
  if (!connector) throw badRequest('OAuth Connector configuration is unavailable.')
  if (connector.issuer) {
    const issuer = connector.issuer.replace(/\/$/, '')
    const response = await deps.externalHttp.fetch(
      new Request(`${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } }),
    )
    if (!response.ok) throw badRequest('OIDC discovery failed.')
    const metadata = await readObject(response, 'OIDC discovery response is invalid.')
    if (
      typeof metadata.issuer !== 'string' ||
      metadata.issuer.replace(/\/$/, '') !== issuer ||
      typeof metadata.authorization_endpoint !== 'string' ||
      typeof metadata.token_endpoint !== 'string'
    ) {
      throw badRequest('OIDC discovery response does not match the configured issuer.')
    }
    return {
      authorizationEndpoint: requireHttpsUrl(metadata.authorization_endpoint, 'authorization endpoint'),
      tokenEndpoint: requireHttpsUrl(metadata.token_endpoint, 'token endpoint'),
      userInfoEndpoint:
        typeof metadata.userinfo_endpoint === 'string'
          ? requireHttpsUrl(metadata.userinfo_endpoint, 'userinfo endpoint')
          : null,
    }
  }
  if (!connector.authorizationEndpoint || !connector.tokenEndpoint) {
    throw badRequest('OAuth Connector endpoints are incomplete.')
  }
  return {
    authorizationEndpoint: requireHttpsUrl(connector.authorizationEndpoint, 'authorization endpoint'),
    tokenEndpoint: requireHttpsUrl(connector.tokenEndpoint, 'token endpoint'),
    userInfoEndpoint: connector.userInfoEndpoint
      ? requireHttpsUrl(connector.userInfoEndpoint, 'userinfo endpoint')
      : null,
  }
}

async function fetchOAuthProfile(deps: Deps, endpoint: string, accessToken: string) {
  const response = await deps.externalHttp.fetch(
    new Request(endpoint, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    }),
  )
  if (!response.ok) throw badRequest('OAuth userinfo request failed.')
  return readObject(response, 'OAuth userinfo response is invalid.')
}

async function readObject(response: Response, message: string): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message)
  return value as Record<string, unknown>
}

function requireHttpsUrl(value: string, label: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw badRequest(`OAuth ${label} must be an HTTPS URL without userinfo.`)
  }
  return url.toString()
}

function oauthVerifierContext(intentId: string) {
  return `external-oauth-intent:${intentId}:pkce-verifier`
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

import { ApiError, badRequest, notFound, OAuthError, oauthError } from '@server/domain/errors'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import { authenticateApplicationClient } from '@server/usecases/oauth-client-authentication'
import type {
  ApplicationAggregate,
  CreateFederatedCredentialInput,
  JwksGateway,
  ResolvedFederatedCredential,
  UpdateFederatedCredentialInput,
} from '@server/usecases/ports'
import {
  applicationEffectiveResourceScopes,
  userEffectiveResourceScopes,
} from '@server/usecases/resource-scope-entitlements'
import { activeResourceVisibleToOrganization } from '@server/usecases/resource-visibility'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { realmrootCliClientId, realmrootOrganizationClaim } from '@shared/oauth-token-profile'

export const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const refreshTokenGrantType = 'refresh_token'
export const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'
export const idTokenType = 'urn:ietf:params:oauth:token-type:id_token'
export const jwtTokenType = 'urn:ietf:params:oauth:token-type:jwt'

const defaultExpiresInSeconds = 60 * 60
const delegatedUserExpiresInSeconds = 5 * 60
const defaultRefreshExpiresInSeconds = 30 * 24 * 60 * 60
const refreshTokenPrefix = 'fatr_'
const subjectClaimsMember = 'urn:realmroot:params:oauth:token-exchange:subject-claims'
const opaqueAccessTokenPrefix = 'fatx_'

export interface TokenExchangeJwtSigner {
  issuer: string
  sign(payload: Record<string, unknown>, type: 'at+jwt' | 'JWT'): Promise<string>
}

export interface TokenExchangeJwtVerifier {
  verify(token: string, issuer: string, audience: string): Promise<Record<string, unknown>>
}

export interface TokenExchangeRequest {
  grantType: string
  subjectToken: string
  subjectTokenType: string
  audience: string
  scope?: string
  requestedTokenType?: string
  verifiedSubjectClaims?: Record<string, unknown>
}

export interface TokenExchangeResponse {
  access_token: string
  issued_token_type: typeof accessTokenType | typeof idTokenType
  token_type: 'Bearer'
  expires_in: number
  scope: string
  refresh_token?: string
}

export interface TokenRefreshRequest {
  grantType: string
  refreshToken: string
  scope?: string
}

export interface IntrospectionResponse {
  active: boolean
  iss?: string
  sub?: string
  aud?: string
  client_id?: string
  scope?: string
  exp?: number
  iat?: number
  token_type?: 'Bearer'
  [key: string]: unknown
}

export async function exchangeToken(
  deps: Deps,
  input: TokenExchangeRequest,
  client: { clientId: string; clientSecret: string | null },
  signer: TokenExchangeJwtSigner,
) {
  if (input.grantType !== tokenExchangeGrantType) {
    throw oauthError('unsupported_grant_type', 'Unsupported grant_type.')
  }
  const { client: oauthClient, application } = await authenticateApplicationClient(
    deps,
    client.clientId,
    client.clientSecret,
  )
  const allowedGrantTypes = parseList(oauthClient.grantTypes)
  if (!allowedGrantTypes.includes(tokenExchangeGrantType)) {
    throw oauthError('unauthorized_client', 'Client is not allowed to use token exchange.')
  }
  if (input.requestedTokenType === idTokenType) {
    if (input.subjectTokenType !== accessTokenType) {
      throw oauthError('invalid_request', 'ID tokens require an access_token subject token.')
    }
    return exchangeAgentIdentityToken(deps, input, oauthClient.clientId, application, signer)
  }
  if (input.requestedTokenType && input.requestedTokenType !== accessTokenType) {
    throw oauthError('invalid_request', 'Unsupported requested_token_type.')
  }
  if (input.subjectTokenType === accessTokenType) {
    return exchangeDelegatedUserToken(deps, input, oauthClient.clientId, application, signer)
  }
  if (input.subjectTokenType !== jwtTokenType) {
    throw oauthError('invalid_request', 'Unsupported subject_token_type.')
  }

  const assertion = parseJwt(input.subjectToken)
  const issuerValue = readString(assertion.payload.iss)
  const subject = readString(assertion.payload.sub)
  if (!issuerValue || !subject) throw oauthError('invalid_grant', 'Subject token is missing required claims.')

  // Trust is scoped to the authenticated client's application: only a credential
  // registered under this client may establish the RFC 8693 subject.
  const credential = await resolveCredential(deps, oauthClient.clientId, issuerValue, subject)
  if (credential.ownerOrganizationId !== application.ownerOrganizationId) {
    throw oauthError('invalid_grant', 'Federated credential is outside the Application Organization.')
  }
  if (credential.audience !== input.audience) {
    throw oauthError('invalid_target', 'Requested audience does not match the federated credential.')
  }
  await requireEligibleAudience(deps, credential.audience, credential.ownerOrganizationId)
  const scopes = await resolveApplicationTokenScopes(deps, application, input.audience, input.scope)
  if (scopes.includes('offline_access') && !allowedGrantTypes.includes(refreshTokenGrantType)) {
    throw oauthError('invalid_scope', 'Client is not allowed to issue refresh tokens.')
  }

  await verifySubjectToken(input.subjectToken, assertion, credential, deps.jwks)

  const now = new Date()
  const expiresAt = new Date(
    Math.min(now.getTime() + defaultExpiresInSeconds * 1000, readNumber(assertion.payload.exp)! * 1000),
  )
  const expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
  const claims = {
    [realmrootOrganizationClaim]: credential.ownerOrganizationId,
  }
  const accessToken = await issueJwtAccessToken(signer, {
    clientId: oauthClient.clientId,
    subject,
    audience: credential.audience,
    scopes,
    claims,
    issuedAt: now,
    expiresAt,
  })
  await deps.tokenExchange.storeAccessToken({
    id: deps.ids.generate(),
    tokenHash: await hashProviderSecret(accessToken),
    clientId: oauthClient.clientId,
    credentialId: credential.id,
    subject,
    subjectTokenIssuer: credential.issuer,
    audience: credential.audience,
    scopes,
    claims,
    expiresAt,
  })

  const response: TokenExchangeResponse = {
    access_token: accessToken,
    issued_token_type: accessTokenType,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: scopes.join(' '),
  }
  if (scopes.includes('offline_access')) {
    response.refresh_token = await issueRefreshToken(deps, oauthClient.clientId, deps.ids.generate(), {
      credentialId: credential.id,
      subject,
      subjectTokenIssuer: credential.issuer,
      audience: credential.audience,
      scopes,
      claims,
    })
  }
  return response
}

async function exchangeAgentIdentityToken(
  deps: Deps,
  input: TokenExchangeRequest,
  clientId: string,
  application: ApplicationAggregate,
  signer: TokenExchangeJwtSigner,
): Promise<TokenExchangeResponse> {
  const claims = input.verifiedSubjectClaims
  const actor = claims && isRecord(claims.act) ? claims.act : null
  const auditContext = {
    clientId,
    controllerUserId: claims ? readString(claims.sub) : null,
    actorIssuer: actor ? readString(actor.iss) : null,
    actorSubject: actor ? readString(actor.sub) : null,
    sourceTokenId: claims ? readString(claims.jti) : null,
    organizationId: claims ? readString(claims[realmrootOrganizationClaim]) : null,
    targetAudience: input.audience,
  }
  try {
    const response = await exchangeAgentIdentityTokenVerified(deps, input, clientId, application, signer)
    await appendIdentityTokenExchangeAudit(deps, auditContext, 'allowed', null, null)
    return response
  } catch (error) {
    await appendIdentityTokenExchangeAudit(
      deps,
      auditContext,
      'denied',
      error instanceof OAuthError ? error.error : 'internal_error',
      error instanceof OAuthError ? error.errorDescription : 'ID token exchange failed unexpectedly.',
    )
    throw error
  }
}

async function exchangeAgentIdentityTokenVerified(
  deps: Deps,
  input: TokenExchangeRequest,
  clientId: string,
  application: ApplicationAggregate,
  signer: TokenExchangeJwtSigner,
): Promise<TokenExchangeResponse> {
  const claims = input.verifiedSubjectClaims
  if (!claims) throw oauthError('invalid_grant', 'Subject access token is invalid.')
  const subject = readString(claims.sub)
  const issuer = readString(claims.iss)
  const sourceAudience = readSingleAudience(claims.aud)
  const sourceTokenId = readString(claims.jti)
  const sourceClientId = readString(claims.client_id)
  const expiresAtClaim = readNumber(claims.exp)
  const actor = isRecord(claims.act) ? claims.act : null
  const actorIssuer = actor ? readString(actor.iss) : null
  const actorSubject = actor ? readString(actor.sub) : null
  if (
    !subject ||
    issuer !== signer.issuer ||
    !sourceAudience ||
    !sourceTokenId ||
    sourceClientId !== realmrootCliClientId ||
    !expiresAtClaim ||
    !actorIssuer ||
    !actorSubject
  ) {
    throw oauthError('invalid_grant', 'Agent subject token is missing required claims.')
  }
  if (expiresAtClaim <= Math.floor(Date.now() / 1000)) {
    throw oauthError('invalid_grant', 'Agent subject token is expired.')
  }
  const organizationId = readString(claims[realmrootOrganizationClaim])
  if (!organizationId) throw oauthError('invalid_grant', 'Agent subject token has no Organization context.')

  const [sourceResource, targetApplication, identity, lease] = await Promise.all([
    deps.authorization.findResourceByResourceUrl(sourceAudience),
    deps.applications.findByClientId(input.audience),
    deps.agentIdentities.findByIssuerSubject(actorIssuer, actorSubject),
    deps.externalResources.findActiveTokenLeaseByTokenHash(await sha256(input.subjectToken), new Date()),
  ])
  if (!sourceResource || !activeResourceVisibleToOrganization(sourceResource, application.ownerOrganizationId)) {
    throw oauthError('invalid_grant', 'Agent subject token audience is not eligible for this Application.')
  }
  const policy = application.tokenExchangePolicies.find(
    (candidate) =>
      'targetApplicationId' in candidate &&
      candidate.sourceResourceServerId === sourceResource.id &&
      candidate.targetApplicationId === targetApplication?.id,
  )
  if (!policy) throw oauthError('invalid_target', 'No token exchange policy allows the requested source and target.')
  if (
    !targetApplication ||
    targetApplication.disabled ||
    targetApplication.visibility !== 'private' ||
    targetApplication.ownerOrganizationId !== application.ownerOrganizationId ||
    targetApplication.ownerOrganizationId !== organizationId
  ) {
    throw oauthError('invalid_target', 'Target OIDC Application is not eligible for this exchange.')
  }
  if (!lease) throw oauthError('invalid_grant', 'Agent subject token is inactive or revoked.')
  const sourceRequest = await deps.externalResources.findAccessRequest(lease.requestId)
  if (
    !sourceRequest ||
    sourceRequest.resourceId !== sourceResource.id ||
    sourceRequest.agentIdentityId !== identity?.id
  ) {
    throw oauthError('invalid_grant', 'Agent subject token authority does not match its claims.')
  }
  const identityAggregate = identity ? await deps.agentIdentities.findIdentity(identity.id) : null
  if (
    !identityAggregate ||
    identityAggregate.identity.status !== 'active' ||
    identityAggregate.identity.deletedAt ||
    identityAggregate.identity.ownerUserId !== subject ||
    !identityAggregate.bindings.some(
      (binding) => binding.id === lease.bindingId && binding.status === 'active' && !binding.revokedAt,
    )
  ) {
    throw oauthError('invalid_grant', 'Agent identity or binding is inactive.')
  }
  await requireActiveDelegatedUser(deps, subject)
  const [organization, membership, groups] = await Promise.all([
    deps.authorization.findOrganization(organizationId),
    deps.authorization.findMemberByOrganizationUser(organizationId, subject),
    deps.authorization.listTeamNamesForUser(organizationId, subject),
  ])
  if (!organization || organization.disabled || !membership) {
    throw oauthError('invalid_grant', 'Controller Organization membership is inactive.')
  }
  const requestedScopes = normalizeScopes(input.scope, ['openid', 'groups'])
  const targetOidcScopes = new Set<string>(targetApplication.oidcScopes)
  if (
    requestedScopes.length !== 2 ||
    !requestedScopes.includes('openid') ||
    !requestedScopes.includes('groups') ||
    requestedScopes.some((scope) => !targetOidcScopes.has(scope))
  ) {
    throw oauthError('invalid_scope', 'Requested identity scope is unavailable for the target Application.')
  }

  const now = new Date()
  const expiresAt = new Date(Math.min(now.getTime() + delegatedUserExpiresInSeconds * 1000, expiresAtClaim * 1000))
  const idToken = await signer.sign(
    {
      iss: signer.issuer,
      sub: subject,
      aud: targetApplication.clientId,
      azp: clientId,
      act: { iss: actorIssuer, sub: actorSubject },
      groups,
      [realmrootOrganizationClaim]: organizationId,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      jti: crypto.randomUUID(),
    },
    'JWT',
  )
  return {
    access_token: idToken,
    issued_token_type: idTokenType,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    scope: requestedScopes.join(' '),
  }
}

async function appendIdentityTokenExchangeAudit(
  deps: Deps,
  context: {
    clientId: string
    controllerUserId: string | null
    actorIssuer: string | null
    actorSubject: string | null
    sourceTokenId: string | null
    organizationId: string | null
    targetAudience: string
  },
  result: 'allowed' | 'denied',
  reasonCode: string | null,
  failureReason: string | null,
) {
  const identity =
    context.actorIssuer && context.actorSubject
      ? await deps.agentIdentities.findByIssuerSubject(context.actorIssuer, context.actorSubject)
      : null
  const targetApplication = await deps.applications.findByClientId(context.targetAudience)
  await deps.agentAudit.append({
    id: deps.ids.generate(),
    action: 'oauth.agent_identity_token_exchanged',
    result,
    realmOwned: false,
    ownerUserId: context.organizationId ? null : context.controllerUserId,
    ownerOrganizationId: context.organizationId,
    controllerUserId: context.controllerUserId,
    subjectIssuer: context.actorIssuer,
    subject: context.actorSubject,
    agentIdentityId: identity?.id ?? null,
    hostId: null,
    resourceId: null,
    resourceConnectionId: null,
    accessRequestId: null,
    scopes: ['openid', 'groups'],
    reasonCode,
    metadata: {
      exchangeClientId: context.clientId,
      sourceTokenId: context.sourceTokenId,
      targetApplicationId: targetApplication?.id ?? null,
      targetApplicationClientId: context.targetAudience,
      failureReason,
    },
    occurredAt: new Date(),
  })
}

async function exchangeDelegatedUserToken(
  deps: Deps,
  input: TokenExchangeRequest,
  clientId: string,
  application: ApplicationAggregate,
  signer: TokenExchangeJwtSigner,
): Promise<TokenExchangeResponse> {
  const claims = input.verifiedSubjectClaims
  if (!claims) throw oauthError('invalid_grant', 'Subject access token is invalid.')
  const subject = readString(claims.sub)
  const issuer = readString(claims.iss)
  const sourceAudience = readSingleAudience(claims.aud)
  const expiresAtClaim = readNumber(claims.exp)
  if (!subject || issuer !== signer.issuer || !sourceAudience || !expiresAtClaim) {
    throw oauthError('invalid_grant', 'Subject access token is missing required claims.')
  }
  if (expiresAtClaim <= Math.floor(Date.now() / 1000))
    throw oauthError('invalid_grant', 'Subject access token is expired.')
  if (claims.act !== undefined)
    throw oauthError('invalid_grant', 'Agent access tokens cannot be delegated by an Application.')
  await requireActiveDelegatedUser(deps, subject)

  const [sourceResource, targetResource] = await Promise.all([
    deps.authorization.findResourceByResourceUrl(sourceAudience),
    deps.authorization.findResourceByResourceUrl(input.audience),
  ])
  if (!sourceResource || !activeResourceVisibleToOrganization(sourceResource, application.ownerOrganizationId)) {
    throw oauthError('invalid_grant', 'Subject access token audience is not eligible for this Application.')
  }
  if (!targetResource || !activeResourceVisibleToOrganization(targetResource, application.ownerOrganizationId)) {
    throw oauthError('invalid_target', 'Requested audience is not visible to the Application tenant.')
  }
  const policy = application.tokenExchangePolicies.find(
    (candidate) =>
      'targetResourceServerId' in candidate &&
      candidate.sourceResourceServerId === sourceResource.id &&
      candidate.targetResourceServerId === targetResource.id,
  )
  if (!policy || !('targetResourceServerId' in policy)) {
    throw oauthError('invalid_target', 'No token exchange policy allows the requested source and target.')
  }
  const subjectScopes = new Set(parseSpaceSeparatedClaim(claims.scope))
  const declaredSourceScopes = new Set(sourceResource.scopeRegistry?.scopes.map((scope) => scope.value) ?? [])
  const mappedTargetScopes = new Set(
    policy.scopeMappings
      .filter((mapping) => subjectScopes.has(mapping.sourceScope) && declaredSourceScopes.has(mapping.sourceScope))
      .map((mapping) => mapping.targetScope),
  )
  const applicationScopes = await resolveApplicationTokenScopesForResource(
    deps,
    application,
    targetResource,
    input.scope,
  )
  const organizationClaim = claims[realmrootOrganizationClaim]
  const organizationId = organizationClaim === undefined ? null : readString(organizationClaim)
  if (organizationClaim !== undefined && organizationId === null) {
    throw oauthError('invalid_grant', 'Subject access token Organization claim is invalid.')
  }
  const userScopes = new Set(
    await userEffectiveResourceScopes(deps, subject, targetResource, new Date(), organizationId),
  )
  const scopes = applicationScopes.filter((scope) => mappedTargetScopes.has(scope) && userScopes.has(scope))
  if (scopes.length === 0 || scopes.includes('offline_access')) {
    throw oauthError('invalid_scope', 'Requested delegated scope is unavailable for the target Resource Server.')
  }

  const now = new Date()
  const expiresAt = new Date(Math.min(now.getTime() + delegatedUserExpiresInSeconds * 1000, expiresAtClaim * 1000))
  const accessToken = await issueJwtAccessToken(signer, {
    clientId,
    subject,
    audience: input.audience,
    scopes,
    claims: organizationId ? { [realmrootOrganizationClaim]: organizationId } : {},
    issuedAt: now,
    expiresAt,
  })
  return {
    access_token: accessToken,
    issued_token_type: accessTokenType,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    scope: scopes.join(' '),
  }
}

async function requireActiveDelegatedUser(deps: Deps, subject: string) {
  try {
    const user = await deps.users.getUser(subject)
    if (user.banned) throw oauthError('invalid_grant', 'Subject access token does not represent an active User.')
  } catch (error) {
    if (error instanceof OAuthError) throw error
    if (error instanceof ApiError && error.status === 404) {
      throw oauthError('invalid_grant', 'Subject access token does not represent a User.')
    }
    throw error
  }
}

async function resolveCredential(deps: Deps, applicationClientId: string, issuer: string, subject: string) {
  const candidates = await deps.tokenExchange.findFederatedCredentials(applicationClientId, issuer)
  const credential = candidates.find((item) => item.enabled && subjectMatches(item.subject, subject))
  if (!credential) throw oauthError('invalid_grant', 'No federated credential matches the subject token.')
  return credential
}

export async function refreshToken(
  deps: Deps,
  input: TokenRefreshRequest,
  client: { clientId: string; clientSecret: string | null },
  signer: TokenExchangeJwtSigner,
) {
  if (input.grantType !== refreshTokenGrantType) {
    throw oauthError('unsupported_grant_type', 'Unsupported grant_type.')
  }
  const { client: oauthClient } = await authenticateApplicationClient(deps, client.clientId, client.clientSecret)
  const application = await requireApplicationByClientId(deps, oauthClient.clientId)
  if (!parseList(oauthClient.grantTypes).includes(refreshTokenGrantType)) {
    throw oauthError('unauthorized_client', 'Client is not allowed to use refresh tokens.')
  }

  const row = await deps.tokenExchange.findRefreshTokenByHash(await hashProviderSecret(input.refreshToken))
  if (!row || row.clientId !== oauthClient.clientId) {
    throw oauthError('invalid_grant', 'Refresh token is invalid.')
  }
  const now = new Date()
  if (row.consumedAt) {
    await deps.tokenExchange.revokeRefreshTokenFamily(row.familyId, now)
    throw oauthError('invalid_grant', 'Refresh token reuse was detected.')
  }
  if (row.revokedAt || row.expiresAt.getTime() <= now.getTime()) {
    throw oauthError('invalid_grant', 'Refresh token is invalid or expired.')
  }
  const credential = await deps.tokenExchange.findFederatedCredentialForClient(row.credentialId, oauthClient.clientId)
  if (!credential?.enabled) {
    throw oauthError('invalid_grant', 'The federated credential is no longer active.')
  }
  const tenantId = row.claims[realmrootOrganizationClaim]
  if (
    credential.audience !== row.audience ||
    tenantId !== credential.ownerOrganizationId ||
    !(await isEligibleAudience(deps, credential.audience, credential.ownerOrganizationId))
  ) {
    await deps.tokenExchange.revokeRefreshTokenFamily(row.familyId, now)
    throw oauthError('invalid_grant', 'The refresh token tenant or audience is no longer eligible.')
  }
  const requestedScopes = await resolveApplicationTokenScopes(
    deps,
    application,
    row.audience,
    input.scope ?? row.scopes.join(' '),
  )
  const expiresIn = defaultExpiresInSeconds
  const expiresAt = new Date(now.getTime() + expiresIn * 1000)
  const accessToken = await issueJwtAccessToken(signer, {
    clientId: oauthClient.clientId,
    subject: row.subject,
    audience: row.audience,
    scopes: requestedScopes,
    claims: row.claims,
    issuedAt: now,
    expiresAt,
  })
  const rotated = await prepareRefreshToken(deps, oauthClient.clientId, row.familyId, row.id, {
    credentialId: row.credentialId,
    subject: row.subject,
    subjectTokenIssuer: row.subjectTokenIssuer,
    audience: row.audience,
    scopes: requestedScopes,
    claims: row.claims,
  })
  const stored = await deps.tokenExchange.rotateRefreshToken({
    refreshToken: rotated.record,
    accessToken: {
      id: deps.ids.generate(),
      tokenHash: await hashProviderSecret(accessToken),
      clientId: oauthClient.clientId,
      credentialId: row.credentialId,
      subject: row.subject,
      subjectTokenIssuer: row.subjectTokenIssuer,
      audience: row.audience,
      scopes: requestedScopes,
      claims: row.claims,
      expiresAt,
    },
  })
  if (!stored) {
    await deps.tokenExchange.revokeRefreshTokenFamily(row.familyId, now)
    throw oauthError('invalid_grant', 'Refresh token reuse was detected.')
  }

  return {
    access_token: accessToken,
    issued_token_type: accessTokenType,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: requestedScopes.join(' '),
    refresh_token: rotated.token,
  } satisfies TokenExchangeResponse
}

export async function introspectToken(
  deps: Deps,
  token: string,
  client: { clientId: string; clientSecret: string | null },
  issuer: string,
  verifier: TokenExchangeJwtVerifier,
) {
  await authenticateApplicationClient(deps, client.clientId, client.clientSecret)
  const tokenHash = await hashProviderSecret(token)
  const row = await deps.tokenExchange.findAccessTokenByHash(tokenHash)
  if (row && row.clientId === client.clientId && !row.revokedAt && row.expiresAt.getTime() > Date.now()) {
    if (!token.startsWith(opaqueAccessTokenPrefix)) {
      const payload = await verifier.verify(token, issuer, row.audience).catch(() => null)
      if (!payload || !tokenExchangeJwtMatches(payload, row, issuer)) {
        return { active: false } satisfies IntrospectionResponse
      }
      return {
        ...payload,
        active: true,
        token_type: 'Bearer',
      } satisfies IntrospectionResponse
    }
    return {
      active: true,
      iss: issuer,
      sub: row.subject,
      aud: row.audience,
      client_id: row.clientId,
      scope: row.scopes.join(' '),
      exp: Math.floor(row.expiresAt.getTime() / 1000),
      iat: Math.floor(row.createdAt.getTime() / 1000),
      token_type: 'Bearer',
      [subjectClaimsMember]: row.claims,
    } satisfies IntrospectionResponse
  }

  return { active: false } satisfies IntrospectionResponse
}

export async function isTokenExchangeAccessToken(deps: Deps, token: string) {
  if (token.startsWith(opaqueAccessTokenPrefix)) return true
  return Boolean(await deps.tokenExchange.findAccessTokenByHash(await hashProviderSecret(token)))
}

async function issueJwtAccessToken(
  signer: TokenExchangeJwtSigner,
  input: {
    clientId: string
    subject: string
    audience: string
    scopes: string[]
    claims: Record<string, unknown>
    issuedAt: Date
    expiresAt: Date
  },
) {
  const tenant = input.claims[realmrootOrganizationClaim]
  return signer.sign(
    {
      iss: signer.issuer,
      sub: input.subject,
      aud: input.audience,
      client_id: input.clientId,
      scope: input.scopes.join(' '),
      ...(tenant === undefined ? {} : { [realmrootOrganizationClaim]: tenant }),
      iat: Math.floor(input.issuedAt.getTime() / 1000),
      exp: Math.floor(input.expiresAt.getTime() / 1000),
      jti: crypto.randomUUID(),
    },
    'at+jwt',
  )
}

function tokenExchangeJwtMatches(
  payload: Record<string, unknown>,
  row: NonNullable<Awaited<ReturnType<Deps['tokenExchange']['findAccessTokenByHash']>>>,
  issuer: string,
) {
  if (
    payload.iss !== issuer ||
    payload.sub !== row.subject ||
    payload.aud !== row.audience ||
    payload.client_id !== row.clientId ||
    payload.scope !== row.scopes.join(' ') ||
    payload.exp !== Math.floor(row.expiresAt.getTime() / 1000)
  ) {
    return false
  }
  const expectedTenant = row.claims[realmrootOrganizationClaim]
  return payload.act === undefined && payload[realmrootOrganizationClaim] === expectedTenant
}

export async function listFederatedCredentials(deps: Deps, applicationId: string) {
  await ensureApplication(deps, applicationId)
  return deps.tokenExchange.listFederatedCredentials(applicationId)
}

export async function getFederatedCredential(deps: Deps, applicationId: string, id: string) {
  const row = await deps.tokenExchange.getFederatedCredential(applicationId, id)
  if (!row) throw notFound('Federated credential not found.')
  return row
}

export async function createFederatedCredential(
  deps: Deps,
  applicationId: string,
  input: CreateFederatedCredentialInput,
) {
  await ensureApplication(deps, applicationId)
  if (!input.jwksUrl && !(input.publicKeys && input.publicKeys.length > 0)) {
    throw badRequest('A federated credential requires either jwksUrl or publicKeys.')
  }
  if (input.jwksUrl) validateJwksUrl(input.jwksUrl)
  if (input.publicKeys) validatePublicKeys(input.publicKeys)
  await ensureAudienceResource(deps, applicationId, input.audienceResourceId)
  return deps.tokenExchange.createFederatedCredential(applicationId, input)
}

export async function updateFederatedCredential(
  deps: Deps,
  applicationId: string,
  id: string,
  input: UpdateFederatedCredentialInput,
) {
  const current = await deps.tokenExchange.getFederatedCredential(applicationId, id)
  if (!current) throw notFound('Federated credential not found.')
  if (input.audienceResourceId) await ensureAudienceResource(deps, applicationId, input.audienceResourceId)
  const jwksUrl = input.jwksUrl === undefined ? current.jwksUrl : input.jwksUrl
  const publicKeys = input.publicKeys === undefined ? current.publicKeys : input.publicKeys
  if (!jwksUrl && !(publicKeys && publicKeys.length > 0)) {
    throw badRequest('A federated credential requires either jwksUrl or publicKeys.')
  }
  if (jwksUrl) validateJwksUrl(jwksUrl)
  if (publicKeys) validatePublicKeys(publicKeys)
  const row = await deps.tokenExchange.updateFederatedCredential(applicationId, id, input)
  if (!row) throw notFound('Federated credential not found.')
  return row
}

export async function deleteFederatedCredential(deps: Deps, applicationId: string, id: string) {
  const deleted = await deps.tokenExchange.deleteFederatedCredential(applicationId, id)
  if (!deleted) throw notFound('Federated credential not found.')
}

async function ensureApplication(deps: Deps, applicationId: string) {
  const application = await deps.applications.findById(applicationId)
  if (!application) throw notFound('Application not found.')
}

async function requireApplicationByClientId(deps: Deps, clientId: string) {
  const application = await deps.applications.findByClientId(clientId)
  if (!application || application.disabled) throw oauthError('unauthorized_client', 'Application is not active.')
  return application
}

async function resolveApplicationTokenScopes(
  deps: Deps,
  application: ApplicationAggregate,
  audience: string,
  requestedScope: string | undefined,
) {
  const resource = await deps.authorization.findResourceByResourceUrl(audience)
  if (!resource || !activeResourceVisibleToOrganization(resource, application.ownerOrganizationId)) {
    throw oauthError('invalid_target', 'Requested audience is not visible to the Application tenant.')
  }
  return resolveApplicationTokenScopesForResource(deps, application, resource, requestedScope)
}

async function resolveApplicationTokenScopesForResource(
  deps: Deps,
  application: ApplicationAggregate,
  resource: ApiResourceResponse,
  requestedScope: string | undefined,
) {
  const configuredScopes =
    application.resourceScopes.find((configuration) => configuration.resourceServerId === resource.id)?.scopes ?? []
  const allowedScopes = [...application.oidcScopes, ...configuredScopes]
  const requestedScopes = normalizeScopes(requestedScope, allowedScopes)
  const oidcScopes = new Set<string>(application.oidcScopes)
  const effectiveScopes = new Set(await applicationEffectiveResourceScopes(deps, application, resource))
  return requestedScopes.filter((scope) => oidcScopes.has(scope) || effectiveScopes.has(scope))
}

async function ensureAudienceResource(deps: Deps, applicationId: string, id: string) {
  const application = await deps.applications.findById(applicationId)
  if (!application) throw notFound('Application not found.')
  const resource = await deps.authorization.findResource(id)
  if (!resource || !activeResourceVisibleToOrganization(resource, application.ownerOrganizationId)) {
    throw badRequest('audienceResourceId must reference a Resource Server visible to the Application tenant.')
  }
}

async function requireEligibleAudience(deps: Deps, audience: string, organizationId: string) {
  if (!(await isEligibleAudience(deps, audience, organizationId))) {
    throw oauthError('invalid_target', 'Requested audience is not eligible for the Application tenant.')
  }
}

async function isEligibleAudience(deps: Deps, audience: string, organizationId: string) {
  const resource = await deps.authorization.findResourceByResourceUrl(audience)
  return Boolean(resource && activeResourceVisibleToOrganization(resource, organizationId))
}

export function parseBasicClientAuthorization(header: string | null) {
  if (!header) return null
  const match = /^Basic\s+(.+)$/i.exec(header.trim())
  if (!match?.[1]) return null
  try {
    const decoded = atob(match[1])
    const index = decoded.indexOf(':')
    if (index < 0) return null
    return {
      clientId: decodeFormComponent(decoded.slice(0, index)),
      clientSecret: decodeFormComponent(decoded.slice(index + 1)),
    }
  } catch {
    return null
  }
}

function normalizeScopes(scope: string | undefined, allowedScopes: string[]) {
  const scopes = [...new Set((scope || '').split(/\s+/).filter(Boolean))]
  for (const item of scopes) {
    if (!allowedScopes.includes(item)) throw oauthError('invalid_scope', `Scope is not allowed: ${item}`)
  }
  return scopes
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function issueRefreshToken(
  deps: Deps,
  clientId: string,
  familyId: string,
  input: {
    credentialId: string
    subject: string
    subjectTokenIssuer: string
    audience: string
    scopes: string[]
    claims: Record<string, unknown>
  },
) {
  const prepared = await prepareRefreshToken(deps, clientId, familyId, null, input)
  const stored = await deps.tokenExchange.storeRefreshToken(prepared.record)
  if (!stored) throw oauthError('invalid_grant', 'Refresh token family was revoked.')
  return prepared.token
}

async function prepareRefreshToken(
  deps: Deps,
  clientId: string,
  familyId: string,
  parentId: string | null,
  input: {
    credentialId: string
    subject: string
    subjectTokenIssuer: string
    audience: string
    scopes: string[]
    claims: Record<string, unknown>
  },
) {
  const token = `${refreshTokenPrefix}${base64Url(randomBytes(32))}`
  const now = new Date()
  return {
    token,
    record: {
      id: deps.ids.generate(),
      familyId,
      parentId,
      tokenHash: await hashProviderSecret(token),
      clientId,
      ...input,
      expiresAt: new Date(now.getTime() + defaultRefreshExpiresInSeconds * 1000),
    },
  }
}

function decodeFormComponent(value: string) {
  return decodeURIComponent(value.replaceAll('+', ' '))
}

function parseJwt(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) throw oauthError('invalid_grant', 'Invalid subject token.')
  try {
    const header = readJsonPart(parts[0])
    const payload = readJsonPart(parts[1])
    if (!isRecord(header) || !isRecord(payload)) throw oauthError('invalid_grant', 'Invalid subject token.')
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: base64UrlDecode(parts[2]) }
  } catch (error) {
    if (error instanceof OAuthError) throw error
    throw oauthError('invalid_grant', 'Invalid subject token.')
  }
}

export function unverifiedSubjectTokenAudience(token: string) {
  return readSingleAudience(parseJwt(token).payload.aud)
}

async function verifySubjectToken(
  token: string,
  assertion: ReturnType<typeof parseJwt>,
  credential: ResolvedFederatedCredential,
  jwks: JwksGateway,
) {
  const now = Math.floor(Date.now() / 1000)
  const exp = readNumber(assertion.payload.exp)
  const nbf = readNumber(assertion.payload.nbf)
  if (exp === null || exp <= now) throw oauthError('invalid_grant', 'Subject token is expired or missing an exp claim.')
  if (assertion.payload.nbf !== undefined && nbf === null) {
    throw oauthError('invalid_grant', 'Subject token nbf claim is invalid.')
  }
  if (nbf !== null && nbf > now) throw oauthError('invalid_grant', 'Subject token is not active yet.')
  if (!audienceMatches(assertion.payload.aud, credential.audience)) {
    throw oauthError('invalid_grant', 'Subject token audience is invalid.')
  }

  const alg = readString(assertion.header.alg)
  if (!alg || alg === 'none') throw oauthError('invalid_grant', 'Subject token algorithm is invalid.')
  const data = new TextEncoder().encode(assertion.signingInput)

  // Asymmetric (preferred): inline public JWK set or a fetched JWKS endpoint.
  if (alg === 'RS256' || alg === 'ES256') {
    try {
      const jwk = await selectCredentialJwk(credential, jwks, readString(assertion.header.kid), alg)
      const key = await importVerificationKey(jwk, alg)
      const algorithm = verificationAlgorithm(alg)
      if (!(await crypto.subtle.verify(algorithm, key, assertion.signature, data))) {
        throw oauthError('invalid_grant', 'Subject token signature is invalid.')
      }
    } catch (error) {
      if (error instanceof OAuthError) throw error
      throw oauthError('invalid_grant', 'Subject token verification key is unavailable.')
    }
    return token
  }

  throw oauthError('invalid_grant', `Unsupported subject token algorithm: ${alg}`)
}

async function selectCredentialJwk(
  credential: ResolvedFederatedCredential,
  jwks: JwksGateway,
  kid: string | null,
  alg: string,
) {
  const keys = credential.publicKeys ?? (credential.jwksUrl ? await fetchJwksKeys(jwks, credential.jwksUrl) : null)
  if (!keys) throw oauthError('invalid_grant', 'Federated credential has no verification key.')
  if (!kid && keys.length !== 1) {
    throw oauthError('invalid_grant', 'Subject token must identify one signing key.')
  }
  const key = keys.find((item) => isRecord(item) && (!kid || item.kid === kid) && (!item.alg || item.alg === alg))
  if (!isRecord(key)) throw oauthError('invalid_grant', 'Subject token signing key was not found.')
  return key as JsonWebKey
}

async function fetchJwksKeys(jwks: JwksGateway, jwksUrl: string): Promise<Record<string, unknown>[]> {
  const body = await jwks.fetchKeys(jwksUrl)
  if (!isRecord(body) || !Array.isArray(body.keys)) {
    throw oauthError('invalid_grant', 'Federated credential JWKS is invalid.')
  }
  return body.keys as Record<string, unknown>[]
}

function subjectMatches(pattern: string, subject: string) {
  if (pattern.endsWith('*')) return subject.startsWith(pattern.slice(0, -1))
  return pattern === subject
}

function validateJwksUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw badRequest('jwksUrl must be a valid public HTTPS URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || isPrivateHostname(url.hostname)) {
    throw badRequest('jwksUrl must be a valid public HTTPS URL.')
  }
}

function validatePublicKeys(keys: Record<string, unknown>[]) {
  const keyIds = new Set<string>()
  for (const key of keys) {
    const keyId = readString(key.kid)
    if (keys.length > 1 && !keyId) throw badRequest('Each public key requires kid when multiple keys are configured.')
    if (keyId) {
      if (keyIds.has(keyId)) throw badRequest('Federated public key kid values must be unique.')
      keyIds.add(keyId)
    }
    if ('d' in key || 'p' in key || 'q' in key || 'dp' in key || 'dq' in key || 'qi' in key || 'k' in key) {
      throw badRequest('Federated credentials accept public verification keys only.')
    }
    const alg = readString(key.alg)
    const use = readString(key.use)
    const keyOps = key.key_ops
    if (
      (use && use !== 'sig') ||
      (keyOps !== undefined &&
        (!Array.isArray(keyOps) || !keyOps.includes('verify') || keyOps.some((operation) => operation !== 'verify'))) ||
      (key.kty === 'RSA'
        ? (alg && alg !== 'RS256') || !readString(key.n) || !readString(key.e)
        : key.kty === 'EC'
          ? (alg && alg !== 'ES256') || key.crv !== 'P-256' || !readString(key.x) || !readString(key.y)
          : true)
    ) {
      throw badRequest('Federated public keys must be RS256 RSA or ES256 P-256 verification keys.')
    }
  }
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  )
}

async function importVerificationKey(jwk: JsonWebKey, alg: string) {
  if (alg === 'RS256') {
    return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
}

function verificationAlgorithm(alg: string) {
  if (alg === 'RS256') return { name: 'RSASSA-PKCS1-v1_5' }
  return { name: 'ECDSA', hash: 'SHA-256' }
}

function audienceMatches(value: unknown, audience: string) {
  return value === audience || (Array.isArray(value) && value.includes(audience))
}

function readJsonPart(value: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readSingleAudience(value: unknown) {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string' && value[0].length > 0) return value[0]
  return null
}

function parseSpaceSeparatedClaim(value: unknown) {
  return typeof value === 'string' ? [...new Set(value.split(/\s+/).filter(Boolean))] : []
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseList(value: string | null) {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

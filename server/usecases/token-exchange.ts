import { badRequest, unauthorized } from '@server/domain/errors'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import type {
  JwksGateway,
  OAuthClientRecord,
  TokenExchangeRepository,
  TrustedExternalIssuerRecord,
} from '@server/usecases/ports'

export const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const refreshTokenGrantType = 'refresh_token'
export const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'
export const jwtTokenType = 'urn:ietf:params:oauth:token-type:jwt'

const defaultExpiresInSeconds = 60 * 60
const defaultRefreshExpiresInSeconds = 30 * 24 * 60 * 60
const refreshTokenPrefix = 'fatr_'

type RefreshTokenPayload = {
  typ: 'token_exchange_refresh'
  clientId: string
  issuerId: string
  subject: string
  subjectTokenIssuer: string
  audience: string
  scopes: string[]
  claims: Record<string, unknown>
  exp: number
  iat: number
}

export interface TokenExchangeRequest {
  grantType: string
  subjectToken: string
  subjectTokenType: string
  audience: string
  scope?: string
  requestedTokenType?: string
}

export interface TokenExchangeResponse {
  access_token: string
  issued_token_type: typeof accessTokenType
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
) {
  if (input.grantType !== tokenExchangeGrantType) {
    throw badRequest('Unsupported grant_type.')
  }
  if (input.subjectTokenType !== jwtTokenType) {
    throw badRequest('Only JWT subject_token_type is supported.')
  }
  if (input.requestedTokenType && input.requestedTokenType !== accessTokenType) {
    throw badRequest('Only access_token requested_token_type is supported.')
  }

  const oauthClient = await authenticateClient(deps, client.clientId, client.clientSecret)
  const allowedGrantTypes = parseList(oauthClient.grantTypes)
  if (!allowedGrantTypes.includes(tokenExchangeGrantType)) {
    throw unauthorized('Client is not allowed to use token exchange.')
  }

  const scopes = normalizeScopes(input.scope, parseList(oauthClient.scopes))
  if (scopes.includes('offline_access') && !allowedGrantTypes.includes(refreshTokenGrantType)) {
    throw badRequest('Client is not allowed to issue refresh tokens.')
  }
  const assertion = parseJwt(input.subjectToken)
  const issuerValue = readString(assertion.payload.iss)
  const subject = readString(assertion.payload.sub)
  if (!issuerValue || !subject) throw unauthorized('Subject token is missing required claims.')

  const issuer = await deps.tokenExchange.findTrustedIssuer(issuerValue)
  if (!issuer?.enabled) throw unauthorized('Subject token issuer is not trusted.')
  if (issuer.allowedAudiences?.length && !issuer.allowedAudiences.includes(input.audience)) {
    throw unauthorized('Audience is not allowed for this issuer.')
  }

  await verifySubjectToken(input.subjectToken, assertion, issuer, input.audience, deps.jwks)

  const expiresIn = defaultExpiresInSeconds
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expiresIn * 1000)
  const accessToken = `fatx_${base64Url(randomBytes(32))}`
  const claims = tokenClaims(assertion.payload)
  await deps.tokenExchange.storeAccessToken({
    id: createId('tex'),
    tokenHash: await hashProviderSecret(accessToken),
    clientId: oauthClient.clientId,
    issuerId: issuer.id,
    subject,
    subjectTokenIssuer: issuer.issuer,
    audience: input.audience,
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
    response.refresh_token = await issueRefreshToken(oauthClient, {
      issuerId: issuer.id,
      subject,
      subjectTokenIssuer: issuer.issuer,
      audience: input.audience,
      scopes,
      claims,
    })
  }
  return response
}

export async function refreshToken(deps: Deps, input: TokenRefreshRequest) {
  if (input.grantType !== refreshTokenGrantType) {
    throw badRequest('Unsupported grant_type.')
  }
  const oauthClient = await authenticateRefreshClient(deps, input.refreshToken)
  if (!parseList(oauthClient.grantTypes).includes(refreshTokenGrantType)) {
    throw unauthorized('Client is not allowed to use refresh tokens.')
  }

  const payload = await verifyRefreshToken(input.refreshToken, oauthClient)
  if (payload.clientId !== oauthClient.clientId) {
    throw unauthorized('Refresh token client does not match.')
  }
  const requestedScopes = input.scope ? normalizeScopes(input.scope, payload.scopes) : payload.scopes
  const expiresIn = defaultExpiresInSeconds
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expiresIn * 1000)
  const accessToken = `fatx_${base64Url(randomBytes(32))}`
  await deps.tokenExchange.storeAccessToken({
    id: createId('tex'),
    tokenHash: await hashProviderSecret(accessToken),
    clientId: oauthClient.clientId,
    issuerId: payload.issuerId,
    subject: payload.subject,
    subjectTokenIssuer: payload.subjectTokenIssuer,
    audience: payload.audience,
    scopes: requestedScopes,
    claims: payload.claims,
    expiresAt,
  })

  return {
    access_token: accessToken,
    issued_token_type: accessTokenType,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: requestedScopes.join(' '),
  } satisfies TokenExchangeResponse
}

export async function introspectToken(
  deps: Deps,
  token: string,
  client: { clientId: string; clientSecret: string | null },
) {
  await authenticateClient(deps, client.clientId, client.clientSecret)
  const row = await deps.tokenExchange.findAccessTokenByHash(await hashProviderSecret(token))
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    return { active: false } satisfies IntrospectionResponse
  }
  return {
    active: true,
    iss: row.subjectTokenIssuer,
    sub: row.subject,
    aud: row.audience,
    client_id: row.clientId,
    scope: row.scopes.join(' '),
    exp: Math.floor(row.expiresAt.getTime() / 1000),
    iat: Math.floor(row.createdAt.getTime() / 1000),
    token_type: 'Bearer',
    ...row.claims,
  } satisfies IntrospectionResponse
}

export async function createTrustedIssuer(
  deps: Deps,
  input: Parameters<TokenExchangeRepository['createTrustedIssuer']>[0],
) {
  if (!input.jwksUrl && !input.sharedSecret) {
    throw badRequest('Trusted issuers require either jwksUrl or sharedSecret.')
  }
  return deps.tokenExchange.createTrustedIssuer(input)
}

export function listTrustedIssuers(deps: Deps) {
  return deps.tokenExchange.listTrustedIssuers()
}

async function authenticateClient(deps: Deps, clientId: string, clientSecret: string | null) {
  if (!clientId || !clientSecret) throw unauthorized('Client authentication is required.')
  const client = await deps.tokenExchange.findClient(clientId)
  if (!client || client.disabled) throw unauthorized('Invalid client credentials.')
  if (!client.clientSecret || client.clientSecret !== (await hashProviderSecret(clientSecret))) {
    throw unauthorized('Invalid client credentials.')
  }
  return client
}

async function authenticateRefreshClient(deps: Deps, refreshTokenValue: string) {
  const payload = readUnsignedRefreshPayload(refreshTokenValue)
  const client = await deps.tokenExchange.findClient(payload.clientId)
  if (!client || client.disabled || !client.clientSecret) throw unauthorized('Invalid refresh token.')
  return client
}

export function parseBasicClientAuthorization(header: string | null) {
  if (!header) return null
  const match = /^Basic\s+(.+)$/i.exec(header.trim())
  if (!match?.[1]) return null
  const decoded = atob(match[1])
  const index = decoded.indexOf(':')
  if (index < 0) return null
  return {
    clientId: decodeURIComponent(decoded.slice(0, index)),
    clientSecret: decodeURIComponent(decoded.slice(index + 1)),
  }
}

function normalizeScopes(scope: string | undefined, allowedScopes: string[]) {
  const scopes = (scope || '').split(/\s+/).filter(Boolean)
  for (const item of scopes) {
    if (!allowedScopes.includes(item)) throw badRequest(`Scope is not allowed for this client: ${item}`)
  }
  return scopes
}

async function issueRefreshToken(
  client: OAuthClientRecord,
  input: Omit<RefreshTokenPayload, 'typ' | 'clientId' | 'exp' | 'iat'>,
) {
  const now = Math.floor(Date.now() / 1000)
  const payload: RefreshTokenPayload = {
    typ: 'token_exchange_refresh',
    clientId: client.clientId,
    ...input,
    iat: now,
    exp: now + defaultRefreshExpiresInSeconds,
  }
  return `${refreshTokenPrefix}${await signRefreshPayload(payload, client)}`
}

async function verifyRefreshToken(token: string, client: OAuthClientRecord): Promise<RefreshTokenPayload> {
  if (!token.startsWith(refreshTokenPrefix)) throw unauthorized('Invalid refresh token.')
  const compact = token.slice(refreshTokenPrefix.length)
  const parts = compact.split('.')
  if (parts.length !== 2) throw unauthorized('Invalid refresh token.')
  const [payloadPart, signaturePart] = parts
  const expected = await signRefreshPayloadPart(payloadPart, client)
  if (!(await timingSafeEqual(signaturePart, expected))) throw unauthorized('Invalid refresh token.')
  const payload = readJsonPart(payloadPart)
  if (!isRefreshTokenPayload(payload)) throw unauthorized('Invalid refresh token.')
  if (payload.typ !== 'token_exchange_refresh') throw unauthorized('Invalid refresh token.')
  if (payload.exp <= Math.floor(Date.now() / 1000)) throw unauthorized('Refresh token is expired.')
  return payload
}

function readUnsignedRefreshPayload(token: string) {
  if (!token.startsWith(refreshTokenPrefix)) throw unauthorized('Invalid refresh token.')
  const compact = token.slice(refreshTokenPrefix.length)
  const parts = compact.split('.')
  if (parts.length !== 2) throw unauthorized('Invalid refresh token.')
  const payload = readJsonPart(parts[0])
  if (!isRefreshTokenPayload(payload)) throw unauthorized('Invalid refresh token.')
  return payload
}

async function signRefreshPayload(payload: RefreshTokenPayload, client: OAuthClientRecord) {
  const payloadPart = base64Url(new TextEncoder().encode(JSON.stringify(payload)))
  return `${payloadPart}.${await signRefreshPayloadPart(payloadPart, client)}`
}

async function signRefreshPayloadPart(payloadPart: string, client: OAuthClientRecord) {
  if (!client.clientSecret) throw unauthorized('Invalid client credentials.')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(client.clientSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart))
  return base64Url(new Uint8Array(signature))
}

async function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

function isRefreshTokenPayload(value: unknown): value is RefreshTokenPayload {
  return (
    isRecord(value) &&
    value.typ === 'token_exchange_refresh' &&
    typeof value.clientId === 'string' &&
    typeof value.issuerId === 'string' &&
    typeof value.subject === 'string' &&
    typeof value.subjectTokenIssuer === 'string' &&
    typeof value.audience === 'string' &&
    Array.isArray(value.scopes) &&
    value.scopes.every((item) => typeof item === 'string') &&
    isRecord(value.claims) &&
    typeof value.exp === 'number' &&
    typeof value.iat === 'number'
  )
}

function parseJwt(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) throw unauthorized('Invalid subject token.')
  const header = readJsonPart(parts[0])
  const payload = readJsonPart(parts[1])
  if (!isRecord(header) || !isRecord(payload)) throw unauthorized('Invalid subject token.')
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: base64UrlDecode(parts[2]) }
}

async function verifySubjectToken(
  token: string,
  assertion: ReturnType<typeof parseJwt>,
  issuer: TrustedExternalIssuerRecord,
  audience: string,
  jwks: JwksGateway,
) {
  const now = Math.floor(Date.now() / 1000)
  const exp = readNumber(assertion.payload.exp)
  const nbf = readNumber(assertion.payload.nbf)
  if (exp === null || exp <= now) throw unauthorized('Subject token is expired or missing an exp claim.')
  if (nbf !== null && nbf > now) throw unauthorized('Subject token is not active yet.')
  if (!audienceMatches(assertion.payload.aud, audience)) throw unauthorized('Subject token audience is invalid.')

  const alg = readString(assertion.header.alg)
  if (!alg || alg === 'none') throw unauthorized('Subject token algorithm is invalid.')
  const data = new TextEncoder().encode(assertion.signingInput)

  if (alg === 'HS256') {
    if (!issuer.sharedSecret) throw unauthorized('Subject token issuer does not allow HS256.')
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(issuer.sharedSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    if (!(await crypto.subtle.verify('HMAC', key, assertion.signature, data))) {
      throw unauthorized('Subject token signature is invalid.')
    }
    return token
  }

  if (!issuer.jwksUrl) throw unauthorized('Subject token issuer does not expose JWKS.')
  const jwk = await selectJwk(jwks, issuer.jwksUrl, readString(assertion.header.kid), alg)
  const key = await importVerificationKey(jwk, alg)
  const algorithm = verificationAlgorithm(alg)
  if (!(await crypto.subtle.verify(algorithm, key, assertion.signature, data))) {
    throw unauthorized('Subject token signature is invalid.')
  }
  return token
}

async function selectJwk(jwks: JwksGateway, jwksUrl: string, kid: string | null, alg: string) {
  const body = await jwks.fetchKeys(jwksUrl)
  if (!isRecord(body) || !Array.isArray(body.keys)) throw unauthorized('Trusted issuer JWKS is invalid.')
  const key = body.keys.find((item) => isRecord(item) && (!kid || item.kid === kid) && (!item.alg || item.alg === alg))
  if (!isRecord(key)) throw unauthorized('Subject token signing key was not found.')
  return key as JsonWebKey
}

async function importVerificationKey(jwk: JsonWebKey, alg: string) {
  if (alg === 'RS256') {
    return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  }
  if (alg === 'ES256') {
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  }
  throw unauthorized(`Unsupported subject token algorithm: ${alg}`)
}

function verificationAlgorithm(alg: string) {
  if (alg === 'RS256') return { name: 'RSASSA-PKCS1-v1_5' }
  if (alg === 'ES256') return { name: 'ECDSA', hash: 'SHA-256' }
  throw unauthorized(`Unsupported subject token algorithm: ${alg}`)
}

function tokenClaims(payload: Record<string, unknown>) {
  const reserved = new Set(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'])
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !reserved.has(key)))
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

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseList(value: string | null) {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
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

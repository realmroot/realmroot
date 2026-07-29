import { ApiError, badRequest, forbidden, unauthorized } from '@server/domain/errors'
import { type AgentAccessTokenVerifier, authenticateAgentAccessToken } from '@server/usecases/agent-tokens'
import type { Deps } from '@server/usecases/deps'
import type { ConnectorRecord, ExternalCredentialRecord } from '@server/usecases/ports'
import { externalCredentialContext, resolveOAuthEndpoints } from './external-accounts'

const forwardedRequestHeaders = new Set([
  'accept',
  'accept-language',
  'content-type',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'x-request-id',
])
const forbiddenRequestHeaders = new Set(['cookie', 'proxy-authorization'])
const strippedTransportHeaders = new Set(['host', 'connection', 'transfer-encoding'])
const forwardedResponseHeaders = new Set([
  'cache-control',
  'content-language',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
  'retry-after',
])

export async function proxyAgentEgress(
  deps: Deps,
  verifier: AgentAccessTokenVerifier,
  request: Request,
  externalAccountId: string,
  rawRelativePath: string,
) {
  const audit: EgressAuditContext = {
    externalAccountId,
    method: request.method.toUpperCase(),
    targetPath: rawRelativePath,
  }
  try {
    const response = await proxyAgentEgressInternal(deps, verifier, request, externalAccountId, rawRelativePath, audit)
    await appendEgressAudit(deps, audit, 'allowed', null, { upstreamStatus: response.status })
    return response
  } catch (error) {
    await appendEgressAudit(deps, audit, 'denied', error instanceof ApiError ? error.code : 'internal_error', null)
    throw error
  }
}

async function proxyAgentEgressInternal(
  deps: Deps,
  verifier: AgentAccessTokenVerifier,
  request: Request,
  externalAccountId: string,
  rawRelativePath: string,
  audit: EgressAuditContext,
) {
  const token = await authenticateAgentAccessToken(deps, request, verifier)
  audit.subjectIssuer = token.subjectIssuer
  audit.subject = token.subject
  audit.agentIdentityId = token.agentIdentityId
  audit.authorityGrantId = token.grantId
  audit.hostId = token.actor.sub as string
  audit.controllerUserId = (await deps.agentTokens.findGrant(token.grantId))?.grantedByUserId ?? null
  const [account, credential, grant] = await Promise.all([
    deps.externalAccounts.findAccount(externalAccountId),
    deps.externalAccounts.findCredential(externalAccountId),
    deps.externalAccounts.findActiveGrant(externalAccountId, token.agentIdentityId),
  ])
  if (!account || account.status !== 'active' || !credential || credential.status !== 'active' || !grant) {
    throw forbidden('No active external account grant permits this egress request.')
  }
  audit.externalAccountGrantId = grant.id
  if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) {
    throw forbidden('External account grant has expired.')
  }
  const connector = await deps.connectors.findById(account.connectorId)
  if (!connector?.enabled || !connector.apiBaseUrl) {
    throw forbidden('External account Connector is unavailable.')
  }
  const method = request.method.toUpperCase()
  if (!connector.allowedMethods?.includes(method) || !grant.allowedMethods.includes(method)) {
    throw forbidden('HTTP method is outside the egress grant.')
  }
  const relativePath = validateRelativePath(rawRelativePath)
  if (
    !connector.allowedPathPrefixes?.some((prefix) => relativePath.startsWith(prefix)) ||
    !grant.allowedPathPrefixes.some((prefix) => relativePath.startsWith(prefix))
  ) {
    throw forbidden('HTTP path is outside the egress grant.')
  }
  if (token.audience !== connector.apiBaseUrl) throw forbidden('Agent token audience does not match the Connector.')
  if (token.scopes.some((scope) => !grant.scopes.includes(scope))) {
    throw forbidden('Agent token scope exceeds the external account grant.')
  }

  const targetOrigin = requirePublicApiOrigin(connector.apiBaseUrl)
  audit.targetOrigin = targetOrigin.origin
  const target = new URL(relativePath + new URL(request.url).search, targetOrigin)
  const headers = copyRequestHeaders(request.headers, connector)
  await injectCredential(deps, headers, connector, credential)

  const upstream = await deps.externalHttp.fetch(
    new Request(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? null : await request.arrayBuffer(),
      redirect: 'manual',
    }),
  )
  if (upstream.status >= 300 && upstream.status < 400) {
    throw forbidden('Upstream redirects are not followed by the credential broker.')
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyResponseHeaders(upstream.headers),
  })
}

interface EgressAuditContext {
  controllerUserId?: string | null
  subjectIssuer?: string | null
  subject?: string | null
  agentIdentityId?: string | null
  hostId?: string | null
  authorityGrantId?: string | null
  externalAccountId: string
  externalAccountGrantId?: string | null
  targetOrigin?: string | null
  targetPath: string
  method: string
}

async function appendEgressAudit(
  deps: Deps,
  context: EgressAuditContext,
  result: 'allowed' | 'denied',
  reasonCode: string | null,
  metadata: Record<string, unknown> | null,
) {
  await deps.agentAudit.append({
    id: `agaudit_${crypto.randomUUID().replaceAll('-', '')}`,
    action: 'external_account.egress',
    result,
    controllerUserId: context.controllerUserId ?? null,
    subjectIssuer: context.subjectIssuer ?? null,
    subject: context.subject ?? null,
    agentIdentityId: context.agentIdentityId ?? null,
    hostId: context.hostId ?? null,
    authorityGrantId: context.authorityGrantId ?? null,
    externalAccountId: context.externalAccountId,
    externalAccountGrantId: context.externalAccountGrantId ?? null,
    targetOrigin: context.targetOrigin ?? null,
    targetPath: context.targetPath,
    method: context.method,
    reasonCode,
    metadata,
    occurredAt: new Date(),
  })
}

async function injectCredential(
  deps: Deps,
  headers: Headers,
  connector: ConnectorRecord,
  credential: ExternalCredentialRecord,
) {
  const payload = await readCredentialPayload(deps, credential)
  if (credential.kind === 'header') {
    if (
      !connector.credentialHeaderName ||
      payload.headerName !== connector.credentialHeaderName ||
      typeof payload.value !== 'string'
    ) {
      throw forbidden('External header credential is invalid.')
    }
    headers.set(connector.credentialHeaderName, payload.value)
    return
  }
  if (credential.kind === 'bearer') {
    if (typeof payload.token !== 'string') throw forbidden('External bearer credential is invalid.')
    headers.set('authorization', `Bearer ${payload.token}`)
    return
  }
  if (credential.kind !== 'oauth') throw forbidden('External credential type is unsupported.')
  const current = await refreshOAuthCredentialIfNeeded(deps, connector, credential, payload)
  if (typeof current.accessToken !== 'string') throw forbidden('External OAuth credential is invalid.')
  headers.set('authorization', `Bearer ${current.accessToken}`)
}

async function refreshOAuthCredentialIfNeeded(
  deps: Deps,
  connector: ConnectorRecord,
  credential: ExternalCredentialRecord,
  payload: Record<string, unknown>,
) {
  if (!credential.expiresAt || credential.expiresAt.getTime() > Date.now() + 30_000) return payload
  if (typeof payload.refreshToken !== 'string' || !connector.clientId || !connector.clientSecret) {
    throw unauthorized('External OAuth credential has expired.')
  }
  const endpoints = await resolveOAuthEndpoints(deps, connector)
  const response = await deps.externalHttp.fetch(
    new Request(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${base64(`${connector.clientId}:${connector.clientSecret}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: payload.refreshToken,
      }),
    }),
  )
  if (!response.ok) throw unauthorized('External OAuth credential refresh failed.')
  const refreshed = await response.json().catch(() => null)
  if (!refreshed || typeof refreshed !== 'object') {
    throw unauthorized('External OAuth refresh response is invalid.')
  }
  const record = refreshed as Record<string, unknown>
  if (typeof record.access_token !== 'string') throw unauthorized('External OAuth refresh response is invalid.')
  const expiresIn =
    typeof record.expires_in === 'number' && record.expires_in > 0 && Number.isFinite(record.expires_in)
      ? record.expires_in
      : null
  const next = {
    accessToken: record.access_token,
    refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : payload.refreshToken,
    tokenType: 'Bearer',
    scope: typeof record.scope === 'string' ? record.scope : payload.scope,
  }
  const now = new Date()
  await deps.externalAccounts.updateCredential(credential.id, {
    encryptedPayload: await deps.secrets.seal(
      JSON.stringify(next),
      externalCredentialContext(credential.externalAccountId, credential.id),
    ),
    expiresAt: expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null,
    updatedAt: now,
  })
  return next
}

async function readCredentialPayload(deps: Deps, credential: ExternalCredentialRecord) {
  const plaintext = await deps.secrets.open(
    credential.encryptedPayload,
    externalCredentialContext(credential.externalAccountId, credential.id),
  )
  const value: unknown = JSON.parse(plaintext)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw forbidden('External credential payload is invalid.')
  }
  return value as Record<string, unknown>
}

function copyRequestHeaders(input: Headers, connector: ConnectorRecord) {
  const headers = new Headers()
  const injectedHeader = connector.credentialHeaderName?.toLowerCase()
  for (const [name, value] of input) {
    const lower = name.toLowerCase()
    if (lower === 'authorization') continue
    if (forbiddenRequestHeaders.has(lower) || lower === injectedHeader) {
      throw badRequest(`Request header ${name} cannot be supplied to Agent egress.`)
    }
    if (strippedTransportHeaders.has(lower) || lower === 'dpop') continue
    if (forwardedRequestHeaders.has(lower)) headers.set(name, value)
  }
  return headers
}

function copyResponseHeaders(input: Headers) {
  const headers = new Headers()
  for (const [name, value] of input) {
    const lower = name.toLowerCase()
    if (forwardedResponseHeaders.has(lower) || lower.startsWith('x-ratelimit-')) headers.set(name, value)
  }
  return headers
}

function validateRelativePath(value: string) {
  const path = value.startsWith('/') ? value : `/${value}`
  if (/\\|\/\/|%(?:2e|2f|5c)/i.test(path)) throw badRequest('Egress path contains forbidden normalization.')
  const normalized = new URL(path, 'https://path.invalid').pathname
  if (normalized !== path) throw badRequest('Egress path is not canonical.')
  return path
}

function requirePublicApiOrigin(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    isPrivateHostname(url.hostname)
  ) {
    throw forbidden('Connector API base URL must be a public HTTPS origin.')
  }
  return url
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

function base64(value: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
}

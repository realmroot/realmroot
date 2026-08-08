import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import express, { type NextFunction, type Request, type Response } from 'express'
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
} from 'jose'

const port = Number(process.env.PORT ?? 4100)
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${port}`
const issuer = origin
const resource = `${origin}/api`
const db = new DatabaseSync(process.env.DATABASE_PATH ?? ':memory:')
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'target-signing-key', use: 'sig', alg: 'ES256' }
const usedDpopProofs = new Map<string, number>()
const usedAgentAssertions = new Map<string, number>()
const projects = [{ id: 'project-1', name: 'Agent-ready project' }]

db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_client (
    client_id TEXT PRIMARY KEY,
    client_secret TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    jwks_uri TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS authorization_code (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    subject TEXT NOT NULL,
    scope TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS refresh_credential (
    token_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    scope TEXT NOT NULL,
    revoked_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS access_credential (
    jti TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    revoked_at INTEGER
  );
`)

const app = express()
app.use(express.urlencoded({ extended: false }))
app.use(express.json())

app.get('/.well-known/oauth-protected-resource/api', (_request, response) => {
  response.json({ resource, authorization_servers: [issuer], scopes_supported: ['projects:read', 'projects:write'] })
})

app.get('/.well-known/oauth-authorization-server', (_request, response) => {
  response.json({
    issuer,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    jwks_uri: `${origin}/jwks`,
    userinfo_endpoint: `${origin}/userinfo`,
    scopes_supported: ['openid', 'offline_access', 'projects:read', 'projects:write'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    dpop_signing_alg_values_supported: ['ES256'],
  })
})

app.get('/.well-known/openid-configuration', (_request, response) => {
  response.redirect(307, '/.well-known/oauth-authorization-server')
})

app.get('/jwks', (_request, response) => response.json({ keys: [publicJwk] }))

app.get('/api', (_request, response) => {
  response
    .set('Link', `<${origin}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`)
    .json({ resource, serviceDescription: `${origin}/openapi.json` })
})

app.get('/openapi.json', (_request, response) => {
  response
    .type('application/vnd.oai.openapi+json')
    .json(projectsOpenAPI('External Projects API', resource, `${origin}/.well-known/openid-configuration`))
})

app.post('/register', (request, response) => {
  const redirectUris = stringArray(request.body.redirect_uris)
  const jwksUri = requiredString(request.body.jwks_uri, 'jwks_uri')
  if (redirectUris.length === 0) throw oauthError('invalid_client_metadata', 'At least one redirect URI is required.')
  const grantTypes = stringArray(request.body.grant_types)
  if (
    !grantTypes.includes('authorization_code') ||
    !grantTypes.includes('refresh_token') ||
    !grantTypes.includes('urn:ietf:params:oauth:grant-type:jwt-bearer') ||
    !grantTypes.includes('urn:ietf:params:oauth:grant-type:token-exchange')
  ) {
    throw oauthError('invalid_client_metadata', 'The required standard OAuth grant types must be registered.')
  }
  const clientId = opaque('client')
  const clientSecret = opaque('secret')
  db.prepare('INSERT INTO oauth_client (client_id, client_secret, redirect_uri, jwks_uri) VALUES (?, ?, ?, ?)').run(
    clientId,
    clientSecret,
    JSON.stringify(redirectUris),
    jwksUri,
  )
  response.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'client_secret_basic',
  })
})

app.get('/authorize', (request, response) => {
  const clientId = requiredQuery(request, 'client_id')
  const redirectUri = requiredQuery(request, 'redirect_uri')
  const state = requiredQuery(request, 'state')
  const scope = requiredQuery(request, 'scope')
  const codeChallenge = requiredQuery(request, 'code_challenge')
  if (request.query.response_type !== 'code' || request.query.code_challenge_method !== 'S256') {
    throw oauthError('invalid_request', 'Authorization code with S256 PKCE is required.')
  }
  const client = findClient(clientId)
  if (!stringArray(JSON.parse(client.redirect_uri)).includes(redirectUri)) {
    throw oauthError('invalid_request', 'Redirect URI does not match.')
  }
  const code = opaque('code')
  db.prepare(
    'INSERT INTO authorization_code (code_hash, client_id, redirect_uri, subject, scope, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(hash(code), clientId, redirectUri, 'demo-user', scope, codeChallenge, Date.now() + 5 * 60_000)
  const callback = new URL(redirectUri)
  callback.searchParams.set('code', code)
  callback.searchParams.set('state', state)
  response.redirect(callback.toString())
})

app.post('/token', async (request, response) => {
  const client = authenticateClient(request)
  switch (request.body.grant_type) {
    case 'authorization_code':
      return authorizationCodeGrant(request, response, client)
    case 'refresh_token':
      return refreshGrant(request, response, client)
    case 'urn:ietf:params:oauth:grant-type:jwt-bearer':
      return jwtBearerGrant(request, response, client)
    case 'urn:ietf:params:oauth:grant-type:token-exchange':
      return tokenExchangeGrant(request, response, client)
    default:
      throw oauthError('unsupported_grant_type', 'Unsupported grant type.')
  }
})

app.post('/revoke', (request, response) => {
  const client = authenticateClient(request)
  const token = requiredString(request.body.token, 'token')
  const claims = unsafeJwtClaims(token)
  if (claims.client_id === client.client_id && typeof claims.jti === 'string') {
    db.prepare('UPDATE access_credential SET revoked_at = ? WHERE jti = ?').run(Date.now(), claims.jti)
  } else {
    db.prepare('UPDATE refresh_credential SET revoked_at = ? WHERE token_hash = ? AND client_id = ?').run(
      Date.now(),
      hash(token),
      client.client_id,
    )
  }
  response.status(200).end()
})

app.get('/userinfo', async (request, response) => {
  const token = bearer(request)
  const { payload } = await jwtVerify(token, publicKey, { issuer, audience: resource })
  response.json({ sub: payload.sub, name: 'Demo Project Owner', preferred_username: 'demo-owner' })
})

app.get('/api/projects', requireDpopAccess, (request, response) => {
  response.json({
    projects,
    authorization: response.locals.authorization,
  })
})

app.post('/api/projects', requireDpopAccess, (_request, response) => {
  const project = { id: `project-${projects.length + 1}`, name: 'Agent-created project' }
  projects.push(project)
  response.location(`/api/projects/${project.id}`).status(201).end()
})

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const normalized = error instanceof OAuthError ? error : oauthError('server_error', 'The target platform rejected the request.')
  if (normalized.status === 401) response.set('WWW-Authenticate', 'DPoP')
  response.status(normalized.status).json({ error: normalized.code, error_description: normalized.message })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`External resource server listening at ${origin}`)
  console.log(`Protected resource: ${resource}`)
})

function projectsOpenAPI(title: string, serverUrl: string, openIdConnectUrl: string) {
  return {
    openapi: '3.1.0',
    info: { title, version: '1.0.0' },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        resourceOidc: {
          type: 'openIdConnect',
          openIdConnectUrl,
          'x-dpop-required': true,
        },
      },
    },
    paths: {
      '/projects': {
        get: {
          operationId: 'listProjects',
          summary: 'List projects available to the delegated Agent',
          security: [{ resourceOidc: ['projects:read'] }],
          responses: {
            '200': {
              description: 'Projects visible through the granted account authority',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['projects', 'authorization'],
                    properties: {
                      projects: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'name'],
                          properties: { id: { type: 'string' }, name: { type: 'string' } },
                        },
                      },
                      authorization: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createProject',
          summary: 'Create a project through delegated Agent authority',
          security: [{ resourceOidc: ['projects:write'] }],
          responses: {
            '201': {
              description: 'Project created',
            },
          },
        },
      },
    },
  }
}

function authorizationCodeGrant(request: Request, response: Response, client: Client) {
  const code = requiredString(request.body.code, 'code')
  const redirectUri = requiredString(request.body.redirect_uri, 'redirect_uri')
  const verifier = requiredString(request.body.code_verifier, 'code_verifier')
  const row = db
    .prepare('SELECT * FROM authorization_code WHERE code_hash = ? AND client_id = ?')
    .get(hash(code), client.client_id) as AuthorizationCode | undefined
  if (!row || row.redirect_uri !== redirectUri || row.expires_at <= Date.now() || sha256Base64Url(verifier) !== row.code_challenge) {
    throw oauthError('invalid_grant', 'Authorization code is invalid.')
  }
  db.prepare('DELETE FROM authorization_code WHERE code_hash = ?').run(hash(code))
  const refreshToken = opaque('refresh')
  db.prepare('INSERT INTO refresh_credential (token_hash, client_id, subject, scope) VALUES (?, ?, ?, ?)').run(
    hash(refreshToken), client.client_id, row.subject, row.scope,
  )
  void issueSubjectToken(client, row.subject, row.scope).then((accessToken) =>
    response.json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 300, scope: row.scope }),
  )
}

function refreshGrant(request: Request, response: Response, client: Client) {
  const refreshToken = requiredString(request.body.refresh_token, 'refresh_token')
  const row = db.prepare('SELECT * FROM refresh_credential WHERE token_hash = ? AND client_id = ?').get(
    hash(refreshToken), client.client_id,
  ) as RefreshCredential | undefined
  if (!row || row.revoked_at) throw oauthError('invalid_grant', 'Refresh credential is invalid.')
  void issueSubjectToken(client, row.subject, row.scope).then((accessToken) =>
    response.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 300, scope: row.scope }),
  )
}

async function tokenExchangeGrant(request: Request, response: Response, client: Client) {
  const subjectToken = requiredString(request.body.subject_token, 'subject_token')
  const actorToken = requiredString(request.body.actor_token, 'actor_token')
  const requestedScope = normalizeScopes(requiredString(request.body.scope, 'scope'))
  const requestedResource = requiredString(request.body.resource, 'resource')
  if (requestedResource !== resource) throw oauthError('invalid_target', 'Resource audience does not match.')
  const subject = await jwtVerify(subjectToken, publicKey, {
    issuer,
    audience: resource,
    typ: 'at+jwt',
    algorithms: ['ES256'],
  })
  const actor = await jwtVerify(actorToken, publicKey, {
    issuer,
    audience: issuer,
    typ: 'at+jwt',
    algorithms: ['ES256'],
  })
  if (actor.payload.client_id !== client.client_id) {
    throw oauthError('invalid_grant', 'Actor access token was not issued to this client.')
  }
  const subjectScopes = normalizeScopes(String(subject.payload.scope ?? ''))
  if (requestedScope.some((scope) => !subjectScopes.includes(scope))) {
    throw oauthError('invalid_scope', 'Requested scope exceeds the connected user grant.')
  }
  const dpop = await verifyDpop(request, `${origin}/token`)
  if (typeof actor.payload.agent_iss !== 'string' || actor.payload.sub_profile !== 'ai_agent') {
    throw oauthError('invalid_grant', 'Actor access token has no stable Agent identity profile.')
  }
  const jti = randomUUID()
  const accessToken = await new SignJWT({
    scope: requestedScope.join(' '),
    client_id: client.client_id,
    act: {
      iss: actor.payload.agent_iss,
      sub: actor.payload.sub,
      sub_profile: actor.payload.sub_profile,
    },
    cnf: { jkt: dpop.jkt },
  })
    .setProtectedHeader({ alg: 'ES256', kid: publicJwk.kid, typ: 'at+jwt' })
    .setIssuer(issuer)
    .setSubject(String(subject.payload.sub))
    .setAudience(resource)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  db.prepare('INSERT INTO access_credential (jti, client_id, subject) VALUES (?, ?, ?)').run(
    jti, client.client_id, String(subject.payload.sub),
  )
  response.json({
    access_token: accessToken,
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    token_type: 'DPoP',
    expires_in: 300,
    scope: requestedScope.join(' '),
  })
}

async function jwtBearerGrant(request: Request, response: Response, client: Client) {
  const assertion = requiredString(request.body.assertion, 'assertion')
  const verified = await jwtVerify(assertion, createRemoteJWKSet(new URL(client.jwks_uri)), {
    audience: `${origin}/token`,
    algorithms: ['RS256'],
  })
  if (
    typeof verified.payload.iss !== 'string' ||
    typeof verified.payload.sub !== 'string' ||
    typeof verified.payload.jti !== 'string' ||
    typeof verified.payload.exp !== 'number'
  ) {
    throw oauthError('invalid_grant', 'JWT bearer assertion requires iss, sub, jti, and exp claims.')
  }
  const now = Math.floor(Date.now() / 1000)
  for (const [candidate, expiresAt] of usedAgentAssertions) {
    if (expiresAt <= now) usedAgentAssertions.delete(candidate)
  }
  const assertionKey = `${verified.payload.iss}:${verified.payload.jti}`
  if (usedAgentAssertions.has(assertionKey)) throw oauthError('invalid_grant', 'JWT bearer assertion was already used.')
  usedAgentAssertions.set(assertionKey, verified.payload.exp)
  const accessToken = await new SignJWT({
    client_id: client.client_id,
    agent_iss: verified.payload.iss,
    sub_profile: 'ai_agent',
  })
    .setProtectedHeader({ alg: 'ES256', kid: publicJwk.kid, typ: 'at+jwt' })
    .setIssuer(issuer)
    .setSubject(verified.payload.sub)
    .setAudience(issuer)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  response.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 300,
  })
}

async function requireDpopAccess(request: Request, response: Response, next: NextFunction) {
  try {
    const token = dpopBearer(request)
    const verified = await jwtVerify(token, publicKey, {
      issuer,
      audience: resource,
      typ: 'at+jwt',
      algorithms: ['ES256'],
    })
    if (typeof verified.payload.jti !== 'string') throw oauthError('invalid_token', 'Access token has no jti.', 401)
    const row = db.prepare('SELECT revoked_at FROM access_credential WHERE jti = ?').get(verified.payload.jti) as
      | { revoked_at: number | null }
      | undefined
    if (!row || row.revoked_at) throw oauthError('invalid_token', 'Access token is revoked.', 401)
    const proof = await verifyDpop(request, `${origin}${request.originalUrl}`, request.method)
    const confirmation = verified.payload.cnf as { jkt?: string } | undefined
    if (typeof confirmation?.jkt !== 'string' || confirmation.jkt !== proof.jkt) {
      throw oauthError('invalid_token', 'DPoP key does not match the access token.', 401)
    }
    if (proof.payload.ath !== sha256Base64Url(token)) throw oauthError('invalid_dpop_proof', 'DPoP ath is invalid.', 401)
    const requiredScope = request.method === 'POST' ? 'projects:write' : 'projects:read'
    if (!normalizeScopes(String(verified.payload.scope ?? '')).includes(requiredScope)) {
      throw oauthError('insufficient_scope', `OAuth scope "${requiredScope}" is required.`, 403)
    }
    response.locals.authorization = { sub: verified.payload.sub, act: verified.payload.act, scope: verified.payload.scope }
    next()
  } catch (error) {
    next(error)
  }
}

async function verifyDpop(request: Request, htu: string, method = 'POST') {
  const compact = request.header('dpop')
  if (!compact) throw oauthError('invalid_dpop_proof', 'DPoP proof is required.', 401)
  const [encodedHeader] = compact.split('.')
  const header = JSON.parse(Buffer.from(encodedHeader!, 'base64url').toString()) as { jwk?: JsonWebKey; alg?: string; typ?: string }
  if (!header.jwk || header.typ?.toLowerCase() !== 'dpop+jwt' || header.alg !== 'ES256') {
    throw oauthError('invalid_dpop_proof', 'DPoP header is invalid.', 401)
  }
  const key = await importJWK(header.jwk, 'ES256')
  const verified = await jwtVerify(compact, key, { typ: 'dpop+jwt' })
  if (verified.payload.htu !== htu || verified.payload.htm !== method || typeof verified.payload.jti !== 'string') {
    throw oauthError('invalid_dpop_proof', 'DPoP proof target is invalid.', 401)
  }
  if (typeof verified.payload.iat !== 'number' || Math.abs(Date.now() / 1000 - verified.payload.iat) > 300) {
    throw oauthError('invalid_dpop_proof', 'DPoP proof is stale.', 401)
  }
  const jkt = await calculateJwkThumbprint(header.jwk)
  consumeDpopJti(jkt, String(verified.payload.jti), verified.payload.iat)
  return { payload: verified.payload, jkt }
}

function consumeDpopJti(jkt: string, jti: string, issuedAt: number) {
  const now = Math.floor(Date.now() / 1000)
  for (const [candidate, expiresAt] of usedDpopProofs) {
    if (expiresAt <= now) usedDpopProofs.delete(candidate)
  }
  const replayKey = `${jkt}:${jti}`
  if (usedDpopProofs.has(replayKey)) throw oauthError('invalid_dpop_proof', 'DPoP proof was already used.', 401)
  usedDpopProofs.set(replayKey, issuedAt + 300)
}

async function issueSubjectToken(client: Client, subject: string, scope: string) {
  return new SignJWT({ scope, client_id: client.client_id })
    .setProtectedHeader({ alg: 'ES256', kid: publicJwk.kid, typ: 'at+jwt' })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(resource)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

function authenticateClient(request: Request) {
  const header = request.header('authorization')
  if (!header?.startsWith('Basic ')) throw oauthError('invalid_client', 'Client authentication is required.', 401)
  const [clientId, clientSecret] = Buffer.from(header.slice(6), 'base64').toString().split(':')
  const client = findClient(clientId ?? '')
  if (client.client_secret !== clientSecret) throw oauthError('invalid_client', 'Client authentication failed.', 401)
  return client
}

function findClient(clientId: string) {
  const client = db.prepare('SELECT * FROM oauth_client WHERE client_id = ?').get(clientId) as Client | undefined
  if (!client) throw oauthError('invalid_client', 'OAuth client was not found.', 401)
  return client
}

function bearer(request: Request) {
  const header = request.header('authorization')
  if (!header?.startsWith('Bearer ')) throw oauthError('invalid_token', 'Bearer token is required.', 401)
  return header.slice(7)
}

function dpopBearer(request: Request) {
  const header = request.header('authorization')
  if (!header?.startsWith('DPoP ')) throw oauthError('invalid_token', 'DPoP access token is required.', 401)
  return header.slice(5)
}

function requiredQuery(request: Request, name: string) {
  const value = request.query[name]
  if (typeof value !== 'string' || !value) throw oauthError('invalid_request', `${name} is required.`)
  return value
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value) throw oauthError('invalid_request', `${name} is required.`)
  return value
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

function normalizeScopes(value: string) {
  return [...new Set(value.split(/\s+/).filter(Boolean))].sort()
}

function unsafeJwtClaims(token: string) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function sha256Base64Url(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function opaque(prefix: string) {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}

class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message)
  }
}

function oauthError(code: string, message: string, status = 400) {
  return new OAuthError(code, message, status)
}

interface Client {
  client_id: string
  client_secret: string
  redirect_uri: string
  jwks_uri: string
}

interface AuthorizationCode {
  redirect_uri: string
  subject: string
  scope: string
  code_challenge: string
  expires_at: number
}

interface RefreshCredential {
  subject: string
  scope: string
  revoked_at: number | null
}

import { createHash } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { calculateJwkThumbprint, createRemoteJWKSet, importJWK, jwtVerify } from 'jose'

const port = Number(process.env.PORT ?? 4101)
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${port}`
const resource = `${origin}/api`
const realmrootOrigin = process.env.REALMROOT_ORIGIN ?? 'http://localhost:4189'
const realmrootIssuer = process.env.REALMROOT_ISSUER ?? `${realmrootOrigin}/api/auth`
const realmrootJwksUrl = process.env.REALMROOT_JWKS_URL ?? `${realmrootOrigin}/api/auth/jwks`
const realmrootJwks = createRemoteJWKSet(new URL(realmrootJwksUrl))
const usedDpopProofs = new Map<string, number>()

const app = express()

app.get('/.well-known/oauth-protected-resource/api', (_request, response) => {
  response.json({
    resource,
    authorization_servers: [realmrootIssuer],
    scopes_supported: ['projects:read'],
  })
})

app.get('/api', (_request, response) => {
  response
    .set('Link', `<${origin}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`)
    .json({ resource, serviceDescription: `${origin}/openapi.json` })
})

app.get('/openapi.json', (_request, response) => {
  response.type('application/vnd.oai.openapi+json').json({
    openapi: '3.1.0',
    info: { title: 'Realmroot-native Projects API', version: '1.0.0' },
    servers: [{ url: resource }],
    components: {
      securitySchemes: {
        realmrootOidc: {
          type: 'openIdConnect',
          openIdConnectUrl: `${realmrootIssuer}/.well-known/openid-configuration`,
        },
      },
    },
    paths: {
      '/projects': {
        get: {
          operationId: 'listProjects',
          summary: 'List projects available to the delegated Agent',
          security: [{ realmrootOidc: ['projects:read'] }],
          responses: {
            '200': {
              description: 'Projects visible through the Realmroot grant',
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
      },
    },
  })
})

app.get('/api/projects', requireRealmrootDpopAccess, (_request, response) => {
  response.json({
    projects: [{ id: 'project-1', name: 'Realmroot-native project' }],
    authorization: response.locals.authorization,
  })
})

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const normalized = error instanceof OAuthError ? error : oauthError('server_error', 'The resource rejected the request.')
  if (normalized.status === 401) response.set('WWW-Authenticate', 'DPoP')
  response.status(normalized.status).json({ error: normalized.code, error_description: normalized.message })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Native resource server listening at ${origin}`)
  console.log(`Realmroot issuer: ${realmrootIssuer}`)
  console.log(`Protected resource: ${resource}`)
})

async function requireRealmrootDpopAccess(request: Request, response: Response, next: NextFunction) {
  try {
    const token = dpopBearer(request)
    const verified = await jwtVerify(token, realmrootJwks, {
      issuer: realmrootIssuer,
      audience: resource,
      typ: 'at+jwt',
    })
    const proof = await verifyDpop(request, `${origin}${request.originalUrl}`, request.method)
    if ((verified.payload.cnf as { jkt?: string } | undefined)?.jkt !== proof.jkt) {
      throw oauthError('invalid_token', 'DPoP key does not match the access token.', 401)
    }
    if (proof.payload.ath !== sha256Base64Url(token)) {
      throw oauthError('invalid_dpop_proof', 'DPoP ath is invalid.', 401)
    }
    response.locals.authorization = {
      sub: verified.payload.sub,
      act: verified.payload.act,
      scope: verified.payload.scope,
      roles: verified.payload.roles,
      groups: verified.payload.groups,
    }
    next()
  } catch (error) {
    next(error)
  }
}

async function verifyDpop(request: Request, htu: string, method: string) {
  const compact = request.header('dpop')
  if (!compact) throw oauthError('invalid_dpop_proof', 'DPoP proof is required.', 401)
  const [encodedHeader] = compact.split('.')
  const header = JSON.parse(Buffer.from(encodedHeader!, 'base64url').toString()) as {
    jwk?: JsonWebKey
    alg?: string
    typ?: string
  }
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

function dpopBearer(request: Request) {
  const header = request.header('authorization')
  if (!header?.startsWith('DPoP ')) throw oauthError('invalid_token', 'DPoP access token is required.', 401)
  return header.slice(5)
}

function sha256Base64Url(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message)
  }
}

function oauthError(code: string, message: string, status = 400) {
  return new OAuthError(code, message, status)
}

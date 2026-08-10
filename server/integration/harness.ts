import { env } from 'cloudflare:test'
import { createAuth } from '@server/auth'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import { agent, agentCapabilityGrant, agentHost, approvalRequest } from '@server/db/schema'
import type { Env, RuntimeConfig } from '@server/env'
import { createApp } from '@server/http/app'
import type { AgentAssertionSigner } from '@server/usecases/external-resources'
import { publishWebhookEvent } from '@server/usecases/webhooks'
import type { SecurityPolicy } from '@shared/api/security'

export const baseURL = 'http://localhost'
const authSecret = 'integration-secret-with-enough-entropy-2026-realmroot'

/**
 * The crown wires the real composition root over the pool's real D1. Only the
 * outward network/storage gateways (email, R2) are stubbed at the env boundary
 * — every repository, usecase, and SQL statement is the production code path.
 */
function integrationEnv(): Env {
  return {
    DB: env.DB,
    ASSET_BUCKET: noopBucket(),
    EMAIL: { send: async () => ({ messageId: 'integration' }) },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    BETTER_AUTH_SECRET: authSecret,
    CREDENTIAL_ENCRYPTION_KEY: 'integration-credential-encryption-key-2026',
    BETTER_AUTH_URL: baseURL,
    TRUSTED_ORIGINS: baseURL,
    EMAIL_FROM: 'noreply@example.com',
    EMAIL_FROM_NAME: 'Realmroot',
  } as unknown as Env
}

function integrationConfig(): RuntimeConfig {
  return {
    authSecret,
    baseURL,
    credentialEncryptionKey: 'integration-credential-encryption-key-2026',
    emailFrom: 'noreply@example.com',
    emailFromName: 'Realmroot',
    trustedOrigins: [baseURL],
    securityPolicy: integrationSecurityPolicy(),
  }
}

function integrationSecurityPolicy(): SecurityPolicy {
  return {
    mfa: { mode: 'optional', authenticatorAppEnabled: true, emailOtpEnabled: false, backupCodesEnabled: true },
    passkeys: { enabled: true, rpId: 'localhost', rpName: 'Realmroot', origins: [baseURL] },
    sessions: {
      expiresInSeconds: 60 * 60 * 24 * 7,
      updateAgeSeconds: 60 * 60 * 24,
      freshAgeSeconds: 60 * 60 * 24,
      cookieCacheSeconds: 60 * 5,
    },
    password: {
      minLength: 8,
      requiredCharacterTypes: 1,
      customWords: [],
      rejectUserInfo: false,
      rejectSequential: false,
      rejectCustomWords: false,
    },
    captcha: { enabled: false, provider: 'turnstile', siteKey: '', projectId: null, secretKey: '' },
    blocklist: { blockSubaddressing: false, entries: [] },
  } as SecurityPolicy
}

export interface Harness {
  app: ReturnType<typeof createApp>
  request: (input: string, init?: RequestInit) => Promise<Response>
  db: ReturnType<typeof createDb>
  deps: ReturnType<typeof createDeps>
  agentTokenSigner: AgentAssertionSigner
}

/**
 * Build the production app over real D1.
 */
export async function createHarness(options: { validAudiences?: string[] } = {}): Promise<Harness> {
  const config = integrationConfig()
  const deps = createDeps(integrationEnv(), config)
  const db = createDb(env.DB)
  const emailSender = deps.email
  const auth = createAuth(
    db,
    deps.ids,
    config.authSecret,
    config.baseURL,
    config.trustedOrigins,
    emailSender,
    config.securityPolicy,
    undefined,
    {
      validAudiences: options.validAudiences,
      externalHttp: deps.externalHttp,
      publishWebhookEvent: async (event, data) => {
        await publishWebhookEvent(deps, event, data)
      },
    },
  )

  const app = createApp(auth, deps, {
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    securityPolicy: config.securityPolicy,
  })

  return {
    app,
    request: async (input, init) => app.request(new URL(input, baseURL).toString(), init, integrationEnv()),
    db,
    deps,
    agentTokenSigner: {
      issuer: `${config.baseURL}/api/auth`,
      sign: async (payload, type) =>
        (
          await auth.api.signJWT({
            body: { payload, overrideOptions: { jwt: { type } } },
          })
        ).token,
    },
  }
}

const admin = {
  email: 'admin@example.com',
  username: 'admin',
  name: 'Realmroot Admin',
  password: 'admin-password-2026',
}

/** Bootstraps the first admin so the management surface accepts a signed-in admin. */
export async function bootstrapAdmin(harness: Harness): Promise<void> {
  const response = await harness.request('/api/onboarding/admin-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(admin),
  })
  if (response.status !== 201) {
    throw new Error(`admin bootstrap failed (${response.status}): ${await response.text()}`)
  }
}

function sessionCookie(response: Response): string {
  return (response.headers.get('set-cookie') ?? '')
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .filter((pair) => pair.includes('='))
    .join('; ')
}

/** Signs a credential user in via real Better Auth and returns the session cookie header. */
export async function signIn(harness: Harness, email: string, password: string): Promise<string> {
  const response = await harness.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (response.status !== 200) {
    throw new Error(`sign-in failed (${response.status}): ${await response.text()}`)
  }
  const cookie = sessionCookie(response)
  if (!cookie) throw new Error('sign-in did not set a session cookie')
  return cookie
}

/** Bootstraps the admin and returns the admin session cookie — the common crown setup. */
export async function signInAdmin(harness: Harness): Promise<string> {
  await bootstrapAdmin(harness)
  return signIn(harness, admin.email, admin.password)
}

interface ManagedUser {
  email: string
  username: string
  displayName: string
  password: string
  role?: 'admin' | 'user'
}

/** Creates a managed user through the real admin endpoint and returns its id. */
export async function createUser(harness: Harness, adminCookie: string, user: ManagedUser): Promise<string> {
  const response = await harness.request('/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role: 'user', ...user }),
  })
  if (response.status !== 201) {
    throw new Error(`user creation failed (${response.status}): ${await response.text()}`)
  }
  const body = (await response.json()) as { user?: { id: string }; id?: string }
  const id = body.user?.id ?? body.id
  if (!id) throw new Error('user creation did not return an id')
  return id
}

export interface SeededAgent {
  hostId: string
  agentId: string
  grantId: string
}

/**
 * Seeds an active agent host + agent + capability grant + approval request for a
 * user. No HTTP surface mints these (the agent-auth protocol does), so the crown
 * seeds them directly to exercise the agent repository's list/revoke SQL paths.
 */
export async function seedAgent(harness: Harness, userId: string, suffix = '1'): Promise<SeededAgent> {
  const now = new Date()
  const hostId = `agent-host-${suffix}`
  const agentId = `agent-${suffix}`
  const grantId = `agent-grant-${suffix}`
  await harness.db
    .insert(agentHost)
    .values({ id: hostId, name: 'Workstation', userId, status: 'active', createdAt: now, updatedAt: now })
  await harness.db.insert(agent).values({
    id: agentId,
    name: 'Assistant',
    userId,
    hostId,
    status: 'active',
    mode: 'delegated',
    publicKey: 'pk',
    createdAt: now,
    updatedAt: now,
  })
  await harness.db.insert(agentCapabilityGrant).values({
    id: grantId,
    agentId,
    capability: 'account.profile.read',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })
  await harness.db.insert(approvalRequest).values({
    id: `agent-approval-${suffix}`,
    method: 'ciba',
    agentId,
    hostId,
    userId,
    status: 'pending',
    interval: 5,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  })
  return { hostId, agentId, grantId }
}

export async function resourceOpenApiFetch(request: Request) {
  if (request.url.includes('/.well-known/oauth-protected-resource')) {
    return Response.json({
      resource: resourceUrlFromMetadataUrl(request.url),
      scopes_supported: ['resource:read'],
    })
  }
  if (new URL(request.url).pathname.endsWith('/openapi.json')) {
    return Response.json({
      openapi: '3.1.0',
      info: { title: 'Test Resource API', description: 'Integration test resource', version: '1.0.0' },
      paths: {},
    })
  }
  return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
}

function resourceUrlFromMetadataUrl(metadataUrl: string) {
  const metadata = new URL(metadataUrl)
  const prefix = '/.well-known/oauth-protected-resource'
  return `${metadata.origin}${metadata.pathname.slice(prefix.length)}${metadata.search}`
}

/**
 * A minimal in-memory R2 stand-in. R2 is the only storage boundary the crown
 * fakes; backing it with a real store lets the asset upload + read round-trip
 * (createAsset/findAsset and the avatar/logo/branding writes) run over real SQL.
 */
function noopBucket() {
  const store = new Map<string, Uint8Array>()
  return {
    put: async (key: string, value: ArrayBuffer | Uint8Array) => {
      store.set(key, value instanceof Uint8Array ? value : new Uint8Array(value))
      return {}
    },
    get: async (key: string) => {
      const value = store.get(key)
      if (!value) return null
      return { body: new Blob([value as BlobPart]).stream() }
    },
    head: async (key: string) => (store.has(key) ? {} : null),
    delete: async (key: string) => {
      store.delete(key)
    },
    list: async () => ({ objects: [] }),
  }
}

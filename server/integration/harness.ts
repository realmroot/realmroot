import { env } from 'cloudflare:test'
import { createEmailSender } from '@server/adapters/gateways/email/sender'
import { createAuth } from '@server/auth'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import { agent, agentCapabilityGrant, agentHost, approvalRequest } from '@server/db/schema'
import type { Env, RuntimeConfig } from '@server/env'
import { createApp } from '@server/http/app'
import { ensureSystemClients } from '@server/usecases/applications'
import type { SecurityPolicy } from '@shared/api/security'

export const baseURL = 'http://localhost'
const authSecret = 'integration-secret-with-enough-entropy-2026-flareauth'

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
    EMAIL_QUEUE: { send: async () => {}, sendBatch: async () => {} },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    BETTER_AUTH_SECRET: authSecret,
    BETTER_AUTH_URL: baseURL,
    TRUSTED_ORIGINS: baseURL,
    EMAIL_FROM: 'noreply@example.com',
    EMAIL_FROM_NAME: 'FlareAuth',
  } as unknown as Env
}

function integrationConfig(): RuntimeConfig {
  return {
    authSecret,
    baseURL,
    emailFrom: 'noreply@example.com',
    emailFromName: 'FlareAuth',
    trustedOrigins: [baseURL],
    securityPolicy: integrationSecurityPolicy(),
  }
}

function integrationSecurityPolicy(): SecurityPolicy {
  return {
    mfa: { mode: 'optional', authenticatorAppEnabled: true, emailOtpEnabled: false, backupCodesEnabled: true },
    passkeys: { enabled: true, rpId: 'localhost', rpName: 'FlareAuth', origins: [baseURL] },
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
    captcha: { enabled: false, provider: 'turnstile', siteKey: '', secretBinding: '' },
    blocklist: { blockSubaddressing: false, entries: [] },
  } as SecurityPolicy
}

export interface Harness {
  app: ReturnType<typeof createApp>
  request: (input: string, init?: RequestInit) => Promise<Response>
  db: ReturnType<typeof createDb>
  deps: ReturnType<typeof createDeps>
}

/**
 * Build the production app over real D1. System OAuth clients are seeded the
 * same way `worker.ts` does so management/token endpoints behave for real.
 */
export async function createHarness(): Promise<Harness> {
  const config = integrationConfig()
  const deps = createDeps(integrationEnv(), config)
  await ensureSystemClients(deps, config.baseURL)

  const db = createDb(env.DB)
  const emailSender = createEmailSender(integrationEnv().EMAIL, {
    from: config.emailFrom,
    fromName: config.emailFromName,
  })
  const auth = createAuth(
    db,
    config.authSecret,
    config.baseURL,
    config.trustedOrigins,
    emailSender,
    config.securityPolicy,
  )

  const app = createApp(auth, deps, {
    trustedOrigins: config.trustedOrigins,
    securityPolicy: config.securityPolicy,
  })

  return {
    app,
    request: async (input, init) => app.request(new URL(input, baseURL).toString(), init),
    db,
    deps,
  }
}

const admin = {
  email: 'admin@example.com',
  username: 'admin',
  name: 'FlareAuth Admin',
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

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Bootstraps the admin and runs the real authorization-code + PKCE + consent flow
 * against the seeded `flareauth-cli` client to obtain a management API access
 * token. Returns the `Authorization: Bearer ...` header value, which drives the
 * bearer-authenticated management surface (the user admin-CRUD repository paths).
 */
export async function signInManagementBearer(harness: Harness): Promise<string> {
  const cookie = await signInAdmin(harness)
  const verifier = 'flareauth-crown-pkce-verifier-0123456789abcdefghijklmnop'
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'flareauth-cli',
    redirect_uri: 'http://127.0.0.1:8484/callback',
    scope: 'openid management:read management:write',
    state: 'crown',
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  })

  const authorize = await harness.request(`/api/auth/oauth2/authorize?${params.toString()}`, {
    headers: { cookie },
    redirect: 'manual',
  })
  const consentQuery = (authorize.headers.get('location') ?? '').split('?')[1] ?? ''

  const consent = await harness.request('/api/auth/oauth2/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: baseURL },
    body: JSON.stringify({ accept: true, oauth_query: consentQuery }),
  })
  if (consent.status !== 200) {
    throw new Error(`oauth consent failed (${consent.status}): ${await consent.text()}`)
  }
  const { url } = (await consent.json()) as { url: string }
  const code = new URL(url, baseURL).searchParams.get('code')
  if (!code) throw new Error('oauth consent did not return an authorization code')

  const token = await harness.request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: baseURL },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'flareauth-cli',
      code,
      redirect_uri: 'http://127.0.0.1:8484/callback',
      code_verifier: verifier,
    }).toString(),
  })
  if (token.status !== 200) {
    throw new Error(`oauth token exchange failed (${token.status}): ${await token.text()}`)
  }
  const { access_token } = (await token.json()) as { access_token: string }
  return `Bearer ${access_token}`
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
  const response = await harness.request('/api/management/users', {
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

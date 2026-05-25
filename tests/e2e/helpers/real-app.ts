import { expect, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'

export const admin = {
  email: 'admin@example.com',
  username: 'admin',
  password: 'admin2026',
  name: 'FlareAuth Admin',
}

export const baseURL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '4189'}`
const e2eWranglerConfig = process.env.E2E_WRANGLER_CONFIG ?? 'tests/e2e/wrangler.toml'
const e2ePersistStatePath = process.env.E2E_PERSIST_STATE_PATH ?? 'tests/e2e/.wrangler/state'
const e2eD1Database = process.env.E2E_D1_DATABASE ?? 'flareauth-db-e2e'

export const e2eConnector = {
  id: 'idp_e2e_oauth',
  slug: 'e2e-oauth',
  providerType: 'generic_oauth',
  providerId: 'e2e-oauth',
  displayName: 'E2E OAuth',
  clientId: 'e2e-client',
  clientSecret: 'E2E_OAUTH_CLIENT_SECRET',
  authorizationEndpoint: 'https://idp.e2e.test/oauth/authorize',
  tokenEndpoint: 'https://idp.e2e.test/oauth/token',
}

export async function resetAndBootstrap() {
  migrate()
  resetLocalData()
  await bootstrapAdmin()
}

export function migrate() {
  run('npx', [
    'wrangler',
    'd1',
    'migrations',
    'apply',
    e2eD1Database,
    '--local',
    '--config',
    e2eWranglerConfig,
    '--persist-to',
    e2ePersistStatePath,
  ])
}

export async function signIn(page: Page, password = admin.password) {
  await page.goto('/sign-in')
  await page.getByRole('textbox', { name: 'Email or username' }).fill(admin.username)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/profile')
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/sign-in/)
}

export async function createOidcApplication(page: Page, name = 'E2E Application') {
  const response = await page.request.post('/api/management/applications', {
    data: {
      name,
      slug: slugify(name),
      clientType: 'public_spa',
      redirectUris: [`${baseURL}/oidc/callback`],
      firstParty: true,
      trusted: true,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export async function createThirdPartyApplication(page: Page, name = 'Third Party E2E Application') {
  const response = await page.request.post('/api/management/applications', {
    data: {
      name,
      slug: slugify(name),
      clientType: 'public_spa',
      redirectUris: [`${baseURL}/oidc/callback`],
      firstParty: false,
      trusted: false,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export async function createUser(page: Page, email: string, username: string) {
  const response = await page.request.post('/api/management/users', {
    data: {
      email,
      username,
      displayName: username,
      password: 'user2026pass',
      role: 'user',
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export async function createOrganization(page: Page, name = 'E2E Organization') {
  const response = await page.request.post('/api/management/organizations', {
    data: {
      name,
      slug: slugify(name),
      displayName: name,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export async function createRole(page: Page, name = 'E2E Role') {
  const response = await page.request.post('/api/management/roles', {
    data: {
      name,
      key: slugify(name),
      description: `${name} role`,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export async function createApiResource(page: Page, name = 'E2E API') {
  const slug = slugify(name)
  const response = await page.request.post('/api/management/api-resources', {
    data: {
      name,
      identifier: `urn:e2e:${slug}`,
      audience: `https://api.e2e.test/${slug}`,
      description: `${name} resource`,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export async function createManagedConnector(page: Page, name = 'E2E Managed OAuth') {
  const response = await page.request.post('/api/management/connectors', {
    data: {
      slug: slugify(name),
      providerType: e2eConnector.providerType,
      providerId: `${e2eConnector.providerId}-${Date.now()}`,
      displayName: name,
      enabled: false,
      clientId: e2eConnector.clientId,
      clientSecret: e2eConnector.clientSecret,
      authorizationEndpoint: e2eConnector.authorizationEndpoint,
      tokenEndpoint: e2eConnector.tokenEndpoint,
      scopes: ['openid', 'email', 'profile'],
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export function seedConnector(input: { clientSecret: string | null }) {
  sql('DELETE FROM identity_provider_connector;')
  sql(`
    INSERT INTO identity_provider_connector (
      id,
      slug,
      provider_type,
      provider_id,
      display_name,
      enabled,
      client_id,
      client_secret,
      authorization_endpoint,
      token_endpoint,
      scopes,
      created_at,
      updated_at
    )
    VALUES (
      '${e2eConnector.id}',
      '${e2eConnector.slug}',
      '${e2eConnector.providerType}',
      '${e2eConnector.providerId}',
      '${e2eConnector.displayName}',
      1,
      '${e2eConnector.clientId}',
      ${input.clientSecret ? `'${input.clientSecret}'` : 'NULL'},
      '${e2eConnector.authorizationEndpoint}',
      '${e2eConnector.tokenEndpoint}',
      '["openid","email","profile"]',
      ${Date.now()},
      ${Date.now()}
    );
  `)
}

export function latestVerificationValue(identifier: string) {
  const escaped = sqlString(identifier)
  const rows = sqlRows<{ value: string }>(`
    SELECT value FROM verification
    WHERE identifier = ${escaped} OR identifier LIKE '%' || ${escaped}
    ORDER BY created_at DESC
    LIMIT 1;
  `)
  return rows[0]?.value.split(':')[0] ?? null
}

export function currentUserId(email = admin.email) {
  const rows = sqlRows<{ id: string }>(`
    SELECT id FROM user
    WHERE email = ${sqlString(email)}
    LIMIT 1;
  `)
  return rows[0]?.id ?? null
}

export function seedAuthorizedApplication(input: {
  applicationId: string
  clientId: string
  userId: string
  name: string
}) {
  const now = Date.now()
  sql(`
    INSERT INTO application_consent (
      id,
      application_id,
      user_id,
      scopes,
      granted_at
    )
    VALUES (
      'consent_e2e_authorized_app',
      ${sqlString(input.applicationId)},
      ${sqlString(input.userId)},
      '["openid","profile"]',
      ${now}
    );
    INSERT INTO oauth_consent (
      id,
      client_id,
      user_id,
      scopes,
      created_at,
      updated_at
    )
    VALUES (
      'oauthconsent_e2e_authorized_app',
      ${sqlString(input.clientId)},
      ${sqlString(input.userId)},
      '["openid","profile"]',
      ${now},
      ${now}
    );
  `)
}

export function seedAgentAccess(userId: string) {
  const now = Date.now()
  sql(`
    INSERT INTO agent_host (
      id,
      name,
      user_id,
      default_capabilities,
      status,
      created_at,
      updated_at
    )
    VALUES (
      'host_e2e_agent',
      'E2E Agent Host',
      ${sqlString(userId)},
      'account.profile.read account.sessions.list account.authorized_apps.list',
      'active',
      ${now},
      ${now}
    );
    INSERT INTO agent (
      id,
      name,
      user_id,
      host_id,
      status,
      mode,
      public_key,
      created_at,
      updated_at
    )
    VALUES (
      'agent_e2e_desktop',
      'E2E Desktop Agent',
      ${sqlString(userId)},
      'host_e2e_agent',
      'active',
      'delegated',
      'public-key',
      ${now},
      ${now}
    );
    INSERT INTO agent_capability_grant (
      id,
      agent_id,
      capability,
      granted_by,
      status,
      created_at,
      updated_at
    )
    VALUES (
      'grant_e2e_profile',
      'agent_e2e_desktop',
      'account.profile.read',
      ${sqlString(userId)},
      'active',
      ${now},
      ${now}
    );
    INSERT INTO approval_request (
      id,
      method,
      agent_id,
      host_id,
      user_id,
      capabilities,
      status,
      interval,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (
      'approval_e2e_agent',
      'device_authorization',
      'agent_e2e_desktop',
      'host_e2e_agent',
      ${sqlString(userId)},
      'account.profile.read account.sessions.list account.authorized_apps.list',
      'approved',
      5,
      ${now + 3600000},
      ${now},
      ${now}
    );
  `)
}

export function resetLocalData() {
  sql(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM webhook_delivery_request;
    DELETE FROM webhook_endpoint;
    DELETE FROM user_role_assignment;
    DELETE FROM application_role_assignment;
    DELETE FROM member_role_assignment;
    DELETE FROM role_permission;
    DELETE FROM invitation;
    DELETE FROM member;
    DELETE FROM role;
    DELETE FROM api_permission;
    DELETE FROM api_scope;
    DELETE FROM api_resource;
    DELETE FROM application_consent;
    DELETE FROM application_client_secret;
    DELETE FROM application_client_metadata WHERE application_id <> 'app_flareauth_cli';
    DELETE FROM application WHERE id <> 'app_flareauth_cli';
    DELETE FROM oauth_access_token;
    DELETE FROM oauth_refresh_token;
    DELETE FROM oauth_consent;
    DELETE FROM oauth_client WHERE client_id <> 'flareauth-cli';
    DELETE FROM passkey;
    DELETE FROM wallet_address;
    DELETE FROM two_factor;
    DELETE FROM verification;
    DELETE FROM session;
    DELETE FROM account;
    DELETE FROM user;
    DELETE FROM identity_provider_connector;
    DELETE FROM sign_in_experience;
    DELETE FROM account_center_setting;
    DELETE FROM branding_setting;
    DELETE FROM uploaded_asset;
    DELETE FROM approval_request;
    DELETE FROM agent_capability_grant;
    DELETE FROM agent;
    DELETE FROM agent_host;
    DELETE FROM organization;
    PRAGMA foreign_keys = ON;
  `)
}

export function walletAddressRows(address: string) {
  return sqlRows<{ user_id: string; address: string; chain_id: number; is_primary: number }>(`
    SELECT user_id, address, chain_id, is_primary
    FROM wallet_address
    WHERE lower(address) = lower(${sqlString(address)});
  `)
}

export async function bootstrapAdmin() {
  const response = await fetch(`${baseURL}/api/onboarding/admin-users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(admin),
  })
  if (!response.ok) {
    throw new Error(`Admin bootstrap failed with ${response.status}: ${await response.text()}`)
  }
}

export function trackProjectErrors(page: Page) {
  const failedProjectResponses: string[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === baseURL && response.status() >= 400) {
      failedProjectResponses.push(`${response.status()} ${url.pathname}`)
    }
  })
  return failedProjectResponses
}

export async function attachCoverage(testInfo: TestInfo, covered: string[]) {
  await testInfo.attach('journey-coverage', {
    body: JSON.stringify({ covered }, null, 2),
    contentType: 'application/json',
  })
}

function sql(command: string) {
  run('npx', [
    'wrangler',
    'd1',
    'execute',
    e2eD1Database,
    '--local',
    '--config',
    e2eWranglerConfig,
    '--persist-to',
    e2ePersistStatePath,
    '--command',
    command,
  ])
}

function sqlRows<T>(command: string): T[] {
  const output = run('npx', [
    'wrangler',
    'd1',
    'execute',
    e2eD1Database,
    '--local',
    '--config',
    e2eWranglerConfig,
    '--persist-to',
    e2ePersistStatePath,
    '--json',
    '--command',
    command,
  ])
  const parsed = JSON.parse(output) as Array<{ results?: T[] }>
  return parsed.flatMap((entry) => entry.results ?? [])
}

function run(command: string, args: string[]) {
  return execFileSync(command, args, {
    cwd: new URL('../../..', import.meta.url),
    env: {
      ...process.env,
      E2E_OAUTH_CLIENT_SECRET: 'e2e-secret',
    },
    encoding: 'utf8',
  })
}

function slugify(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

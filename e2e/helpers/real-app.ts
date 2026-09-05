import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { e2eFetch } from './http'

export const admin = {
  email: 'admin@example.com',
  username: 'admin',
  password: 'admin2026',
  name: 'Realmroot Admin',
}

export const organizationOwner = {
  email: 'owner@example.com',
  username: 'organization-owner',
  password: 'Violet!927Cloud',
  name: 'Organization Owner',
  organizationId: 'org_e2e_owner',
  organizationName: 'E2E Organization',
}

export const baseURL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '4189'}`
const e2eWranglerConfig = process.env.E2E_WRANGLER_CONFIG ?? 'e2e/wrangler.toml'
const e2ePersistStatePath = process.env.CF_PERSIST_STATE_PATH ?? 'e2e/.wrangler/state'
const e2eD1Database = process.env.E2E_D1_DATABASE ?? 'realmroot-db-e2e'
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const commandOutputBufferBytes = 16 * 1024 * 1024

export async function resetAndBootstrap() {
  resetState()
  await bootstrapAdmin()
}

export function resetState() {
  migrate()
  resetLocalData()
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

export async function bootstrapAdmin() {
  const response = await e2eFetch(baseURL, '/api/onboarding/admin-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(admin),
  })
  if (!response.ok) {
    throw new Error(`Admin bootstrap failed with ${response.status}: ${await response.text()}`)
  }
}

export async function signIn(
  page: Page,
  account: Pick<typeof admin, 'username' | 'password'> = admin,
  options: { baseURL?: string; interactiveCaptcha?: boolean } = {},
) {
  await page.goto(options.baseURL ? new URL('/auth/sign-in', options.baseURL).href : '/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email or username' }).fill(account.username)

  if (options.interactiveCaptcha) {
    const captchaResponse = page.locator('input[name="cf-turnstile-response"]')
    await captchaResponse.waitFor({ state: 'attached' })
    console.log('Complete the CAPTCHA in the opened Chrome window to continue PVT.')
    await page.waitForFunction(
      () => Boolean(document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value),
      undefined,
      { timeout: 120_000 },
    )
  }

  const password = page.getByRole('textbox', { name: 'Password' })
  await password.fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  try {
    await page.waitForURL('**/profile')
  } catch (error) {
    if (await password.isVisible()) await password.fill('')
    throw error
  }
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/auth\/sign-in/)
}

export function resetLocalData() {
  sql(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM agent_audit_event;
    DELETE FROM ownership_quarantine;
    DELETE FROM agent_dpop_jti;
    DELETE FROM external_token_lease;
    DELETE FROM resource_scope_entitlement;
    DELETE FROM agent_access_request;
    DELETE FROM resource_connection_intent;
    DELETE FROM provider_resource_authorization;
    DELETE FROM provider_credential;
    DELETE FROM provider_connection;
    DELETE FROM approval_request;
    DELETE FROM agent_identity_binding;
    DELETE FROM agent_enrollment_intent;
    DELETE FROM agent_identity;
    DELETE FROM agent_capability_grant;
    DELETE FROM agent;
    DELETE FROM agent_host;
    DELETE FROM webhook_delivery_attempt;
    DELETE FROM webhook_delivery_request;
    DELETE FROM webhook_endpoint;
    DELETE FROM organization_role;
    DELETE FROM invitation;
    DELETE FROM team_member;
    DELETE FROM team;
    DELETE FROM member;
    DELETE FROM token_exchange_access_token;
    DELETE FROM token_exchange_refresh_token;
    DELETE FROM federated_credential;
    DELETE FROM application_consent;
    DELETE FROM api_resource;
    DELETE FROM application_client_secret;
    DELETE FROM application_client_metadata;
    DELETE FROM application;
    DELETE FROM oauth_access_token;
    DELETE FROM oauth_refresh_token;
    DELETE FROM oauth_consent;
    DELETE FROM oauth_client;
    DELETE FROM device_code;
    DELETE FROM passkey;
    DELETE FROM password_reset_request;
    DELETE FROM wallet_address;
    DELETE FROM two_factor;
    DELETE FROM verification;
    DELETE FROM jwks;
    DELETE FROM session;
    DELETE FROM account;
    DELETE FROM user_profile;
    DELETE FROM user;
    DELETE FROM identity_provider_connector;
    DELETE FROM custom_domain;
    DELETE FROM site_settings;
    DELETE FROM uploaded_asset;
    DELETE FROM organization;
    PRAGMA foreign_keys = ON;
  `)
}

export function seedOrganizationOwner() {
  sql(`
    UPDATE user
    SET email_verified = 1
    WHERE email = '${organizationOwner.email}';
    INSERT INTO organization (id, slug, name)
    VALUES ('${organizationOwner.organizationId}', 'e2e-organization', '${organizationOwner.organizationName}');
    INSERT INTO member (id, organization_id, user_id, role)
    SELECT 'member_e2e_owner', '${organizationOwner.organizationId}', id, 'owner'
    FROM user
    WHERE email = '${organizationOwner.email}';
  `)
}

export function expirePendingAgentApprovals(agentId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error('Invalid Agent id.')
  sql(`
    UPDATE approval_request
    SET expires_at = 0
    WHERE agent_id = '${agentId}' AND status = 'pending';
  `)
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

function run(command: string, args: string[]) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: commandOutputBufferBytes,
  })
}

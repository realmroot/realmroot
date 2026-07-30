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

export const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '4189'}`
const e2eWranglerConfig = process.env.E2E_WRANGLER_CONFIG ?? 'e2e/wrangler.toml'
const e2ePersistStatePath = process.env.CF_PERSIST_STATE_PATH ?? 'e2e/.wrangler/state'
const e2eD1Database = process.env.E2E_D1_DATABASE ?? 'realmroot-db-e2e'
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

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

export async function signIn(page: Page, password = admin.password) {
  await page.goto('/auth/sign-in')
  await page.getByRole('textbox', { name: 'Email or username' }).fill(admin.username)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/profile')
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
    DELETE FROM agent_dpop_jti;
    DELETE FROM external_token_lease;
    DELETE FROM agent_access_grant;
    DELETE FROM agent_access_request;
    DELETE FROM resource_connection_intent;
    DELETE FROM resource_account_connection;
    DELETE FROM external_resource_authorization;
    DELETE FROM agent_identity_binding;
    DELETE FROM agent_enrollment_intent;
    DELETE FROM agent_identity;
    DELETE FROM agent_capability_grant;
    DELETE FROM agent;
    DELETE FROM agent_host;
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
    DELETE FROM application_client_metadata;
    DELETE FROM application;
    DELETE FROM oauth_access_token;
    DELETE FROM oauth_refresh_token;
    DELETE FROM oauth_consent;
    DELETE FROM oauth_client;
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
    DELETE FROM organization;
    PRAGMA foreign_keys = ON;
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
  })
}

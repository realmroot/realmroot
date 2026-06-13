import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { buildTokenClaims } from '@server/usecases/authorization'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function postJson(harness: Harness, cookie: string, path: string, body: unknown, expected = 201) {
  const res = await harness.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  expect(res.status, await res.clone().text()).toBe(expected)
  return res
}

describe('OAuth token claim building over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  // Exercises the authorization repo read paths that only fire during token-claim
  // assembly — findResourceByAudience, listUserRoleAssignments,
  // listApplicationRoleAssignments, and findMemberByOrganizationUser +
  // listMemberRoleAssignments — through real SQL (the usecase tests cover the
  // branching logic with fake ports; this proves the real queries).
  it('resolves audience + user/application/member role assignments [spec: admin-console/oidc-claim-emission]', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'claims-user@example.com',
      username: 'claimsuser',
      displayName: 'Claims User',
      password: 'claims-user-password-2026',
    })

    const audience = 'https://api.example.com/contacts'
    const resource = (await (
      await postJson(harness, cookie, '/api/management/api-resources', {
        identifier: 'contacts-api',
        name: 'Contacts API',
        audience,
      })
    ).json()) as { id: string }
    const scope = (await (
      await postJson(harness, cookie, `/api/management/api-resources/${resource.id}/scopes`, {
        value: 'contacts:read',
      })
    ).json()) as { id: string }
    await postJson(harness, cookie, `/api/management/api-resources/${resource.id}/permissions`, {
      scopeId: scope.id,
      key: 'contacts.read',
    })

    const application = (await (
      await postJson(harness, cookie, '/api/management/applications', {
        name: 'Claims App',
        clientType: 'public_spa',
        redirectUris: ['https://app.example.com/callback'],
      })
    ).json()) as { id: string }

    const organization = (await (
      await postJson(harness, cookie, '/api/management/organizations', { slug: 'claims-org', name: 'Claims Org' })
    ).json()) as { id: string }
    const member = (await (
      await postJson(harness, cookie, `/api/management/organizations/${organization.id}/members`, {
        userId,
        role: 'member',
      })
    ).json()) as { id: string }

    // Distinct roles per subject so each assignment read is independently proven.
    const roleId = async (key: string, name: string) =>
      (
        (await (
          await postJson(harness, cookie, '/api/management/roles', { key, name, resourceId: resource.id })
        ).json()) as { id: string }
      ).id
    const userRole = await roleId('contacts-user-role', 'Contacts User')
    const appRole = await roleId('contacts-app-role', 'Contacts App')
    const memberRole = await roleId('contacts-member-role', 'Contacts Member')

    await postJson(
      harness,
      cookie,
      '/api/management/user-role-assignments',
      { roleId: userRole, subjectId: userId },
      204,
    )
    await postJson(
      harness,
      cookie,
      '/api/management/application-role-assignments',
      { roleId: appRole, subjectId: application.id },
      204,
    )
    await postJson(
      harness,
      cookie,
      '/api/management/member-role-assignments',
      { roleId: memberRole, subjectId: member.id },
      204,
    )

    const claims = (await buildTokenClaims(harness.deps, {
      userId,
      applicationId: application.id,
      organizationId: organization.id,
      resource: audience,
      scopes: ['openid', 'contacts:read'],
      destination: 'access_token',
    })) as { authorization: { audience: string; resource: string; organization_id: string; roles: string[] } }

    // findResourceByAudience returned the registered resource.
    expect(claims.authorization.audience).toBe(audience)
    expect(claims.authorization.resource).toBe('contacts-api')
    expect(claims.authorization.organization_id).toBe(organization.id)
    // Each role surfaced through its own real-SQL assignment read.
    expect(claims.authorization.roles).toEqual(
      expect.arrayContaining(['contacts-user-role', 'contacts-app-role', 'contacts-member-role']),
    )
  })

  it('returns audience-free claims when the resource is unregistered [spec: admin-console/admin-application-oidc-claims]', async () => {
    await signInAdmin(harness)
    const claims = (await buildTokenClaims(harness.deps, {
      userId: 'nobody',
      resource: 'https://unregistered.example.com',
      scopes: ['openid'],
      destination: 'access_token',
    })) as { authorization?: { audience?: string } }
    // findResourceByAudience ran (real SQL) and found nothing → no audience claim.
    expect(claims.authorization?.audience).toBeUndefined()
  })
})

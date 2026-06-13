import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function postJson(harness: Harness, cookie: string, path: string, body: unknown, expected = 201) {
  const response = await harness.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  expect(response.status, await response.clone().text()).toBe(expected)
  return response
}

describe('authorization management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous reads with 401', async () => {
    const response = await harness.request('/api/management/api-resources')
    expect(response.status).toBe(401)
  })

  it('rejects a signed-in non-admin with 403', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'member@example.com',
      username: 'member',
      displayName: 'Member',
      password: 'member-password-2026',
    })
    const memberCookie = await signIn(harness, 'member@example.com', 'member-password-2026')

    const response = await harness.request('/api/management/roles', { headers: { cookie: memberCookie } })
    expect(response.status).toBe(403)
  })

  it('rejects an invalid api-resource payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/api-resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'missing identifier' }),
    })
    expect(response.status).toBe(400)
  })

  it('runs the full api-resource / scope / permission lifecycle through real SQL [spec: management-api/management-restish-api-resource-crud]', async () => {
    const cookie = await signInAdmin(harness)

    const resource = (await (
      await postJson(harness, cookie, '/api/management/api-resources', {
        identifier: 'https://api.example.com',
        name: 'Example API',
        audience: 'https://api.example.com',
      })
    ).json()) as { id: string }

    const list = await harness.request('/api/management/api-resources', { headers: { cookie } })
    expect(((await list.json()) as { resources: unknown[] }).resources.length).toBe(1)

    const fetched = await harness.request(`/api/management/api-resources/${resource.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const patched = await harness.request(`/api/management/api-resources/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Renamed API' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Renamed API')

    const scope = (await (
      await postJson(harness, cookie, `/api/management/api-resources/${resource.id}/scopes`, {
        value: 'documents:read',
      })
    ).json()) as { id: string }
    const scopes = await harness.request(`/api/management/api-resources/${resource.id}/scopes`, {
      headers: { cookie },
    })
    expect(((await scopes.json()) as { scopes: unknown[] }).scopes.length).toBe(1)

    const patchedScope = await harness.request(`/api/management/api-resources/${resource.id}/scopes/${scope.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ description: 'Read documents' }),
    })
    expect(patchedScope.status).toBe(200)

    const permission = (await (
      await postJson(harness, cookie, `/api/management/api-resources/${resource.id}/permissions`, {
        scopeId: scope.id,
        key: 'documents.read',
      })
    ).json()) as { id: string }
    const permissions = await harness.request(`/api/management/api-resources/${resource.id}/permissions`, {
      headers: { cookie },
    })
    expect(((await permissions.json()) as { permissions: unknown[] }).permissions.length).toBe(1)

    const patchedPermission = await harness.request(
      `/api/management/api-resources/${resource.id}/permissions/${permission.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ description: 'Read docs' }),
      },
    )
    expect(patchedPermission.status).toBe(200)

    expect(
      (
        await harness.request(`/api/management/api-resources/${resource.id}/permissions/${permission.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request(`/api/management/api-resources/${resource.id}/scopes/${scope.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request(`/api/management/api-resources/${resource.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
  })

  it('manages roles, role permissions, and a user role assignment through real SQL [spec: management-api/management-restish-role-crud]', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'assignee@example.com',
      username: 'assignee',
      displayName: 'Assignee',
      password: 'assignee-password-2026',
    })

    const resource = (await (
      await postJson(harness, cookie, '/api/management/api-resources', {
        identifier: 'https://roles.example.com',
        name: 'Roles API',
        audience: 'https://roles.example.com',
      })
    ).json()) as { id: string }
    const permission = (await (
      await postJson(harness, cookie, `/api/management/api-resources/${resource.id}/permissions`, {
        key: 'roles.manage',
      })
    ).json()) as { id: string }

    const role = (await (
      await postJson(harness, cookie, '/api/management/roles', {
        key: 'editor',
        name: 'Editor',
        resourceId: resource.id,
      })
    ).json()) as { id: string }

    const roles = await harness.request('/api/management/roles', { headers: { cookie } })
    expect(((await roles.json()) as { roles: unknown[] }).roles.length).toBeGreaterThanOrEqual(1)

    expect((await harness.request(`/api/management/roles/${role.id}`, { headers: { cookie } })).status).toBe(200)

    const patched = await harness.request(`/api/management/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Lead Editor' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Lead Editor')

    const replacePermissions = await harness.request(`/api/management/roles/${role.id}/permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ permissionIds: [permission.id] }),
    })
    expect(replacePermissions.status).toBe(204)

    const rolePermissions = await harness.request(`/api/management/roles/${role.id}/permissions`, {
      headers: { cookie },
    })
    expect(((await rolePermissions.json()) as { permissions: Array<{ id: string }> }).permissions).toEqual([
      expect.objectContaining({ id: permission.id }),
    ])

    // assignUserRole (top-level mount) writes a userRoleAssignment row.
    await postJson(
      harness,
      cookie,
      '/api/management/user-role-assignments',
      { roleId: role.id, subjectId: userId },
      204,
    )
    // assignUserRole (roles-scoped mount) is idempotent on conflict.
    await postJson(
      harness,
      cookie,
      '/api/management/roles/assignments/users',
      { roleId: role.id, subjectId: userId },
      204,
    )

    expect(
      (await harness.request(`/api/management/roles/${role.id}`, { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(204)
  })

  it('runs the organization / member / invitation lifecycle through real SQL [spec: management-api/management-restish-organization-crud]', async () => {
    const cookie = await signInAdmin(harness)
    const memberUserId = await createUser(harness, cookie, {
      email: 'org-member@example.com',
      username: 'orgmember',
      displayName: 'Org Member',
      password: 'org-member-password-2026',
    })

    const organization = (await (
      await postJson(harness, cookie, '/api/management/organizations', { slug: 'acme', name: 'Acme' })
    ).json()) as { id: string }

    const list = await harness.request('/api/management/organizations', { headers: { cookie } })
    expect(((await list.json()) as { organizations: unknown[] }).organizations.length).toBe(1)

    expect(
      (await harness.request(`/api/management/organizations/${organization.id}`, { headers: { cookie } })).status,
    ).toBe(200)

    const patched = await harness.request(`/api/management/organizations/${organization.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Acme Inc' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Acme Inc')

    const member = (await (
      await postJson(harness, cookie, `/api/management/organizations/${organization.id}/members`, {
        userId: memberUserId,
        role: 'member',
      })
    ).json()) as { id: string }
    const members = await harness.request(`/api/management/organizations/${organization.id}/members`, {
      headers: { cookie },
    })
    expect(((await members.json()) as { members: unknown[] }).members.length).toBe(1)

    const patchedMember = await harness.request(
      `/api/management/organizations/${organization.id}/members/${member.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ role: 'admin' }),
      },
    )
    expect(((await patchedMember.json()) as { role: string }).role).toBe('admin')

    // assignMemberRole writes a memberRoleAssignment row.
    const role = (await (
      await postJson(harness, cookie, '/api/management/roles', { key: 'org-lead', name: 'Org Lead' })
    ).json()) as { id: string }
    await postJson(
      harness,
      cookie,
      '/api/management/member-role-assignments',
      { roleId: role.id, subjectId: member.id },
      204,
    )

    const invitation = (await (
      await postJson(harness, cookie, `/api/management/organizations/${organization.id}/invitations`, {
        email: 'invitee@example.com',
        role: 'member',
      })
    ).json()) as { id: string }
    const invitations = await harness.request(`/api/management/organizations/${organization.id}/invitations`, {
      headers: { cookie },
    })
    expect(((await invitations.json()) as { invitations: unknown[] }).invitations.length).toBe(1)

    expect(
      (
        await harness.request(`/api/management/organizations/${organization.id}/invitations/${invitation.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request(`/api/management/organizations/${organization.id}/members/${member.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request(`/api/management/organizations/${organization.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
  })

  it('assigns an application role through real SQL', async () => {
    const cookie = await signInAdmin(harness)

    const application = (await (
      await postJson(harness, cookie, '/api/management/applications', {
        name: 'Role Client',
        slug: 'role-client',
        clientType: 'confidential_web',
        redirectUris: ['http://localhost/callback'],
      })
    ).json()) as { id: string }
    const role = (await (
      await postJson(harness, cookie, '/api/management/roles', { key: 'svc', name: 'Service' })
    ).json()) as { id: string }

    await postJson(
      harness,
      cookie,
      '/api/management/application-role-assignments',
      { roleId: role.id, subjectId: application.id },
      204,
    )
  })
})

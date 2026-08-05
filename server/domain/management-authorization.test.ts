import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  type ManagementBoundary,
  managementBoundaryAllowsOwner,
  managementOwnerColumns,
  ownerFromAgentHomeSpace,
  ownerFromColumns,
  requireManagementOwner,
  resolveManagementOwnerFilter,
} from '@server/domain/management-authorization'
import { managementOperationPolicy, managementScopesForAuthority } from '@shared/management-authorization'
import { describe, expect, it } from 'vitest'

describe('canonical management authorization', () => {
  it('keeps Account authority exact and never inherits Organization membership [spec: management-api/management-single-authorization-boundary]', () => {
    const account = {
      kind: 'restricted',
      accountUserId: 'user-1',
      organizationIds: [],
    } satisfies ManagementBoundary

    expect(managementBoundaryAllowsOwner(account, { kind: 'account', userId: 'user-1' })).toBe(true)
    expect(managementBoundaryAllowsOwner(account, { kind: 'account', userId: 'user-2' })).toBe(false)
    expect(managementBoundaryAllowsOwner(account, { kind: 'organization', organizationId: 'org-1' })).toBe(false)
    expect(resolveManagementOwnerFilter(account, { account: true, organization: true })).toEqual({
      includeRealmOwned: false,
      ownerUserId: 'user-1',
    })
    expect(() => resolveManagementOwnerFilter(account, { account: true, organization: true }, 'org-1')).toThrow()
  })

  it('applies the same owner rule to collection and item authorization', () => {
    const organization = {
      kind: 'restricted',
      accountUserId: null,
      organizationIds: ['org-1'],
    } satisfies ManagementBoundary

    expect(resolveManagementOwnerFilter(organization, { organization: true })).toEqual({
      includeRealmOwned: false,
      ownerOrganizationIds: ['org-1'],
    })
    expect(() => requireManagementOwner(organization, { kind: 'organization', organizationId: 'org-1' })).not.toThrow()
    expect(() => requireManagementOwner(organization, { kind: 'organization', organizationId: 'org-2' })).toThrow()
    expect(() => requireManagementOwner(organization, { kind: 'realm' })).toThrow()
  })

  it('resolves Realm and Organization collection filters without changing the item boundary', () => {
    const realm = { kind: 'realm' } satisfies ManagementBoundary
    const organizations = {
      kind: 'restricted',
      accountUserId: null,
      organizationIds: ['org-1', 'org-2'],
    } satisfies ManagementBoundary

    expect(managementBoundaryAllowsOwner(realm, { kind: 'realm' })).toBe(true)
    expect(managementBoundaryAllowsOwner(realm, { kind: 'account', userId: 'user-1' })).toBe(true)
    expect(resolveManagementOwnerFilter(realm, { realm: true, organization: true })).toEqual({
      includeRealmOwned: true,
      ownerOrganizationIds: undefined,
    })
    expect(resolveManagementOwnerFilter(realm, { organization: true }, 'org-1')).toEqual({
      includeRealmOwned: false,
      ownerOrganizationIds: ['org-1'],
    })
    expect(() => resolveManagementOwnerFilter(realm, { realm: true }, 'org-1')).toThrow()

    expect(resolveManagementOwnerFilter(organizations, { organization: true })).toEqual({
      includeRealmOwned: false,
      ownerOrganizationIds: ['org-1', 'org-2'],
    })
    expect(resolveManagementOwnerFilter(organizations, { organization: true }, 'org-2')).toEqual({
      includeRealmOwned: false,
      ownerOrganizationIds: ['org-2'],
    })
    expect(() => resolveManagementOwnerFilter(organizations, { organization: true }, 'org-3')).toThrow()
    expect(() => resolveManagementOwnerFilter(organizations, { account: true })).toThrow()
  })

  it('keeps a human Account and its authorized Organizations in one boundary', () => {
    const boundary = {
      kind: 'restricted',
      accountUserId: 'user-1',
      organizationIds: ['org-1'],
    } satisfies ManagementBoundary

    expect(managementBoundaryAllowsOwner(boundary, { kind: 'account', userId: 'user-1' })).toBe(true)
    expect(managementBoundaryAllowsOwner(boundary, { kind: 'organization', organizationId: 'org-1' })).toBe(true)
    expect(managementBoundaryAllowsOwner(boundary, { kind: 'organization', organizationId: 'org-2' })).toBe(false)
    expect(resolveManagementOwnerFilter(boundary, { account: true, organization: true })).toEqual({
      includeRealmOwned: false,
      ownerUserId: 'user-1',
      ownerOrganizationIds: ['org-1'],
    })
  })

  it('requires exactly one canonical owner representation', () => {
    expect(managementOwnerColumns({ kind: 'realm' })).toEqual({ ownerUserId: null, ownerOrganizationId: null })
    expect(managementOwnerColumns({ kind: 'account', userId: 'user-1' })).toEqual({
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
    })
    expect(managementOwnerColumns({ kind: 'organization', organizationId: 'org-1' })).toEqual({
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
    })
    expect(ownerFromColumns('user-1', null)).toEqual({ kind: 'account', userId: 'user-1' })
    expect(ownerFromColumns(null, 'org-1')).toEqual({ kind: 'organization', organizationId: 'org-1' })
    expect(ownerFromColumns(null, null)).toEqual({ kind: 'realm' })
    expect(() => ownerFromColumns('user-1', 'org-1')).toThrow(
      'A management resource must have exactly one canonical owner boundary.',
    )
    expect(ownerFromAgentHomeSpace({ type: 'personal', userId: 'user-1' })).toEqual({
      kind: 'account',
      userId: 'user-1',
    })
    expect(ownerFromAgentHomeSpace({ type: 'organization', organizationId: 'org-1' })).toEqual({
      kind: 'organization',
      organizationId: 'org-1',
    })
  })

  it('declares authority and human-controller restrictions per operation', () => {
    expect(managementOperationPolicy('POST', '/api/organizations')).toMatchObject({ authorities: ['realm'] })
    expect(managementOperationPolicy('PATCH', '/api/organizations/org-1')).toMatchObject({
      authorities: ['realm', 'organization'],
      actor: 'human-controller',
    })
    expect(managementOperationPolicy('GET', '/api/access/roles/role-1')).toMatchObject({ authorities: ['realm'] })
    expect(managementOperationPolicy('GET', '/api/access/assignments')).toMatchObject({
      authorities: ['realm', 'organization'],
    })
    expect(managementOperationPolicy('PUT', '/api/access/requests/request-1/decision')).toMatchObject({
      actor: 'human-controller',
    })
    expect(managementOperationPolicy('PATCH', '/api/realm/security-policy')).toMatchObject({
      authorities: ['realm'],
      actor: 'human-controller',
    })
    expect(managementOperationPolicy('GET', '/api/organizations/org-1/unregistered-child')).toBeNull()
    expect(managementOperationPolicy('POST', '/api/applications/app-1/unregistered-action')).toBeNull()
    expect(managementOperationPolicy('PATCH', '/api/organizations/org-1/members')).toBeNull()
    expect(managementOperationPolicy('DELETE', '/api/applications/app-1/redirect-uris')).toBeNull()
    expect(managementOperationPolicy('POST', '/api/access/roles/role-1/scopes')).toBeNull()
    expect(managementOperationPolicy('DELETE', '/api/users')).toBeNull()
  })

  it('publishes only scopes meaningful to each authority', () => {
    expect(managementScopesForAuthority('account')).toEqual(
      expect.arrayContaining(['agents:read', 'audit-events:read']),
    )
    expect(managementScopesForAuthority('account')).not.toContain('agents:write')
    expect(managementScopesForAuthority('account')).not.toEqual(
      expect.arrayContaining(['users:read', 'organizations:write', 'roles:read', 'settings:read']),
    )
    expect(managementScopesForAuthority('organization')).not.toEqual(
      expect.arrayContaining(['users:read', 'connectors:read', 'security:write']),
    )
    expect(managementScopesForAuthority('realm')).toContain('security:read')
    expect(managementScopesForAuthority('realm')).not.toContain('security:write')
  })

  it('contains no legacy management authorization representation or helper', () => {
    const banned = [
      'consoleOrganizationIds',
      'managementAccessScope',
      'getConsoleOrganizationScope',
      'getManagementAccessScope',
      'requireConsoleOrganizationAccess',
      'requireConsoleOwnedOrganization',
      'requireRealmConsoleAccess',
      'resolveOrganizationInventoryScope',
    ]
    const roots = ['server', 'shared']
    const source = roots
      .flatMap((root) => sourceFiles(root))
      .filter((file) => !file.endsWith('management-authorization.test.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    for (const identifier of banned) expect(source, identifier).not.toContain(identifier)
  })
})

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

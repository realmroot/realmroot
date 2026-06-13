import {
  cancelInvitation,
  createOrganization,
  deleteOrganization,
  getOrganization,
  listInvitations,
  listMembers,
  listResources,
  updateOrganization,
  updatePermission,
} from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import { describe, expect, it } from 'vitest'

const pagination = { limit: 20, offset: 0 } as Parameters<typeof listResources>[1]

function emptyPage<T>(items: T[]) {
  return {
    items,
    pagination: { limit: 20, offset: 0, total: items.length, hasMore: false, nextOffset: null },
  }
}

describe('authorization collection and update boundaries', () => {
  it('updates and deletes an organization through its repository', async () => {
    const store = new Map<string, { id: string; name: string }>()
    const updates: Array<{ id: string; patch: unknown }> = []
    const deleted: string[] = []
    const deps = {
      authorization: {
        createOrganization: async (input: { id: string; name: string }) => {
          store.set(input.id, input)
          return input
        },
        findOrganization: async (id: string) => store.get(id) ?? null,
        updateOrganization: async (id: string, patch: unknown) => {
          updates.push({ id, patch })
          const current = store.get(id)
          if (current) store.set(id, { ...current, ...(patch as object) })
        },
        deleteOrganization: async (id: string) => {
          deleted.push(id)
          store.delete(id)
        },
      },
    } as unknown as Deps

    const organization = await createOrganization(deps, { slug: 'acme', name: 'Acme' })

    const updated = await updateOrganization(deps, organization.id, { name: 'Acme Inc.' })
    expect(updated).toMatchObject({ name: 'Acme Inc.' })
    expect(updates).toEqual([{ id: organization.id, patch: { name: 'Acme Inc.' } }])

    await deleteOrganization(deps, organization.id)
    expect(deleted).toEqual([organization.id])
    await expect(getOrganization(deps, organization.id)).rejects.toMatchObject({ status: 404 })
  })

  it('lists members and invitations for an existing organization', async () => {
    const deps = {
      authorization: {
        findOrganization: async () => ({ id: 'org_1', name: 'Acme' }),
        listMembers: async () => emptyPage([{ id: 'mem_1' }]),
        listInvitations: async () => emptyPage([{ id: 'inv_1' }]),
      },
    } as unknown as Deps

    await expect(listMembers(deps, 'org_1', pagination)).resolves.toMatchObject({
      members: [{ id: 'mem_1' }],
      pagination: { total: 1 },
    })
    await expect(listInvitations(deps, 'org_1', pagination)).resolves.toMatchObject({
      invitations: [{ id: 'inv_1' }],
      pagination: { total: 1 },
    })
  })

  it('lists API resources', async () => {
    const deps = {
      authorization: {
        listResources: async () => emptyPage([{ id: 'res_1' }]),
      },
    } as unknown as Deps

    await expect(listResources(deps, pagination)).resolves.toMatchObject({
      resources: [{ id: 'res_1' }],
      pagination: { total: 1 },
    })
  })

  it('rejects canceling an invitation that is missing or belongs to another organization', async () => {
    const mismatch = {
      authorization: {
        findInvitation: async () => ({ id: 'inv_1', organizationId: 'org_other' }),
        cancelInvitation: async () => undefined,
      },
    } as unknown as Deps
    const missing = {
      authorization: {
        findInvitation: async () => null,
        cancelInvitation: async () => undefined,
      },
    } as unknown as Deps

    await expect(cancelInvitation(mismatch, 'org_1', 'inv_1')).rejects.toMatchObject({
      status: 404,
      message: 'Organization invitation was not found.',
    })
    await expect(cancelInvitation(missing, 'org_1', 'inv_1')).rejects.toMatchObject({
      status: 404,
      message: 'Organization invitation was not found.',
    })
  })

  it('cancels an invitation that belongs to the organization', async () => {
    const canceled: string[] = []
    const deps = {
      authorization: {
        findInvitation: async () => ({ id: 'inv_1', organizationId: 'org_1' }),
        cancelInvitation: async (id: string) => {
          canceled.push(id)
        },
      },
    } as unknown as Deps

    await cancelInvitation(deps, 'org_1', 'inv_1')
    expect(canceled).toEqual(['inv_1'])
  })

  it('rebinds a permission to a scope that belongs to the same resource', async () => {
    const resourceId = 'res_1'
    const updates: Array<{ id: string; patch: unknown }> = []
    const deps = {
      authorization: {
        findResource: async () => ({ id: resourceId, identifier: 'api', audience: 'aud' }),
        findPermission: async () => ({ id: 'perm_1', resourceId }),
        findScope: async () => ({ id: 'scope_1', resourceId }),
        updatePermission: async (id: string, patch: unknown) => {
          updates.push({ id, patch })
        },
      },
    } as unknown as Deps

    await updatePermission(deps, resourceId, 'perm_1', { scopeId: 'scope_1', key: 'contacts.read' })
    expect(updates).toEqual([{ id: 'perm_1', patch: { scopeId: 'scope_1', key: 'contacts.read' } }])
  })
})

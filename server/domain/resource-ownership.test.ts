import { resourceOwnershipInventory } from '@server/domain/resource-ownership'
import { describe, expect, it } from 'vitest'

describe('resource ownership inventory', () => {
  it('classifies every authorization-managed public resource family', () => {
    expect(Object.keys(resourceOwnershipInventory).sort()).toEqual([
      'agents',
      'applicationConsents',
      'applications',
      'auditEvents',
      'organizations',
      'platformConfiguration',
      'resourceConnections',
      'resourceServers',
      'webhooks',
    ])
  })

  it('keeps consent user-owned and platform configuration realm-owned', () => {
    expect(resourceOwnershipInventory.applicationConsents.boundary).toBe('user')
    expect(resourceOwnershipInventory.platformConfiguration.boundary).toBe('realm')
    expect(resourceOwnershipInventory.resourceServers.children).toEqual([])
  })
})

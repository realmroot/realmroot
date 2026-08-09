import { describe, expect, it } from 'vitest'
import { developerPolicyOptions } from './extracted/deployment-misc/deployment'

describe('Console product model', () => {
  it('[spec: admin-console/admin-developer-access-policy] keeps creation configurable and Console platform-only', () => {
    expect(developerPolicyOptions.organizationCreation).toContain('Any verified user')
    expect(developerPolicyOptions).not.toHaveProperty('consoleAccess')
    expect(developerPolicyOptions).not.toHaveProperty('eligibleLevels')
  })
})

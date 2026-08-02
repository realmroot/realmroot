import { describe, expect, it } from 'vitest'
import { developerPolicyOptions } from './extracted/deployment-misc/deployment'
import { organizationDetailTabs } from './helpers/helpers-resource'

describe('Console product model', () => {
  it('[spec: admin-console/admin-govern-organization] keeps Organization governance separate from Develop inventory', () => {
    expect(organizationDetailTabs().map((tab) => tab.value)).toEqual([
      'overview',
      'members',
      'agents',
      'activity',
      'settings',
    ])
    expect(organizationDetailTabs().map((tab) => tab.value)).not.toContain('applications')
  })

  it('[spec: admin-console/admin-developer-access-policy] models creation and Console access as independent choices', () => {
    expect(developerPolicyOptions.organizationCreation).toContain('Any verified user')
    expect(developerPolicyOptions.consoleAccess).toContain('Realm operators only')
    expect(developerPolicyOptions.organizationCreation).not.toEqual(developerPolicyOptions.consoleAccess)
  })
})

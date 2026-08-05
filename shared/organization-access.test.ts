import { describe, expect, it } from 'vitest'
import {
  decodeRoleScope,
  encodeRoleScope,
  organizationAccessControl,
  organizationRoles,
  predefinedOrganizationRoleScopes,
} from './organization-access'

describe('Better Auth Organization access-control compatibility', () => {
  it('authorizes opaque scope actions by exact value', () => {
    const opaque = encodeRoleScope('resource/contacts', 'contacts:records/read')
    const dynamic = organizationAccessControl.newRole({
      scope: [opaque],
    } as never)

    expect(dynamic.authorize({ scope: [opaque] } as never)).toEqual({ success: true })
    expect(dynamic.authorize({ scope: [`${opaque}-other`] } as never)).toMatchObject({ success: false })
    expect(decodeRoleScope(opaque)).toEqual({
      resourceId: 'resource/contacts',
      scope: 'contacts:records/read',
    })
  })

  it('keeps predefined Roles aligned with their registry scope mappings', () => {
    for (const [key, role] of Object.entries(organizationRoles)) {
      expect(role.statements.scope).toEqual(predefinedOrganizationRoleScopes[key as keyof typeof organizationRoles])
    }
  })
})

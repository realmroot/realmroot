import { notFound } from '@server/domain/errors'
import {
  createApplicationScopeEntitlement,
  createUserScopeEntitlement,
  getApplicationScopeEntitlement,
  getResource,
  getUserScopeEntitlement,
  listApplicationScopeEntitlements,
  listUserScopeEntitlements,
  revokeApplicationScopeEntitlement,
  revokeUserScopeEntitlement,
} from '@server/usecases/authorization'
import {
  createApplicationScopeEntitlementRequestSchema,
  createUserScopeEntitlementRequestSchema,
  listApplicationScopeEntitlementsResponseSchema,
  listScopeEntitlementsQuerySchema,
  listUserScopeEntitlementsResponseSchema,
  resourceScopeEntitlementResponseSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { getPrincipal } from '../../middleware/authn'
import { authorizedOrganizationIds, authorizeOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementScopeEntitlementsRoute = new Hono()
  .get('/users/:userId/scope-entitlements', async (c) => {
    const result = await listUserScopeEntitlements(
      getDeps(c),
      c.req.param('userId'),
      readQuery(c, listScopeEntitlementsQuerySchema),
      await authorizedOrganizationIds(c, 'scope-entitlements:read'),
    )
    return c.json(listUserScopeEntitlementsResponseSchema.parse(result))
  })
  .post('/users/:userId/scope-entitlements', async (c) => {
    const input = await readJson(c, createUserScopeEntitlementRequestSchema)
    const resource = await getResource(getDeps(c), input.resourceServerId)
    await authorizeOrganization(c, input.organizationId ?? resource.ownerOrganizationId, 'scope-entitlements:write')
    const grant = await createUserScopeEntitlement(getDeps(c), c.req.param('userId'), input, actorUserId(c))
    c.header('Location', grant.links.self)
    return c.json(resourceScopeEntitlementResponseSchema.parse(grant), 201)
  })
  .get('/users/:userId/scope-entitlements/:entitlementId', async (c) => {
    const grant = await getUserScopeEntitlement(getDeps(c), c.req.param('entitlementId'))
    if (grant.userId !== c.req.param('userId')) return c.notFound()
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'scope-entitlements:read')
    return c.json(resourceScopeEntitlementResponseSchema.parse(grant))
  })
  .delete('/users/:userId/scope-entitlements/:entitlementId', async (c) => {
    const grant = await getUserScopeEntitlement(getDeps(c), c.req.param('entitlementId'))
    if (grant.userId !== c.req.param('userId')) return c.notFound()
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'scope-entitlements:write')
    await revokeUserScopeEntitlement(getDeps(c), grant.id)
    return c.body(null, 204)
  })
  .get('/applications/:applicationId/scope-entitlements', async (c) => {
    const application = await requireApplication(c, 'scope-entitlements:read')
    return c.json(
      listApplicationScopeEntitlementsResponseSchema.parse(
        await listApplicationScopeEntitlements(
          getDeps(c),
          application.id,
          readQuery(c, listScopeEntitlementsQuerySchema),
        ),
      ),
    )
  })
  .post('/applications/:applicationId/scope-entitlements', async (c) => {
    const input = await readJson(c, createApplicationScopeEntitlementRequestSchema)
    const application = await requireApplication(c, 'scope-entitlements:write')
    const grant = await createApplicationScopeEntitlement(getDeps(c), application.id, input, actorUserId(c))
    c.header('Location', grant.links.self)
    return c.json(resourceScopeEntitlementResponseSchema.parse(grant), 201)
  })
  .get('/applications/:applicationId/scope-entitlements/:entitlementId', async (c) => {
    const grant = await getApplicationScopeEntitlement(getDeps(c), c.req.param('entitlementId'))
    if (grant.applicationId !== c.req.param('applicationId')) return c.notFound()
    await requireApplication(c, 'scope-entitlements:read')
    return c.json(resourceScopeEntitlementResponseSchema.parse(grant))
  })
  .delete('/applications/:applicationId/scope-entitlements/:entitlementId', async (c) => {
    const grant = await getApplicationScopeEntitlement(getDeps(c), c.req.param('entitlementId'))
    if (grant.applicationId !== c.req.param('applicationId')) return c.notFound()
    await requireApplication(c, 'scope-entitlements:write')
    await revokeApplicationScopeEntitlement(getDeps(c), grant.id)
    return c.body(null, 204)
  })

async function requireApplication(
  c: Parameters<typeof getPrincipal>[0],
  scope: 'scope-entitlements:read' | 'scope-entitlements:write',
) {
  const application = await getDeps(c).applications.findById(c.req.param('applicationId')!)
  if (!application) throw notFound('Application was not found.')
  await authorizeOrganization(c, application.ownerOrganizationId, scope)
  return application
}

function actorUserId(c: Parameters<typeof getPrincipal>[0]) {
  const userId = getPrincipal(c).user?.id
  if (!userId) throw new Error('User principal is required for scope Entitlement administration.')
  return userId
}

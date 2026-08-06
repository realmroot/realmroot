import { notFound } from '@server/domain/errors'
import {
  createApplicationScopeGrant,
  createUserScopeGrant,
  getApplicationScopeGrant,
  getResource,
  getUserScopeGrant,
  listApplicationScopeGrants,
  listUserScopeGrants,
  revokeApplicationScopeGrant,
  revokeUserScopeGrant,
} from '@server/usecases/authorization'
import {
  applicationScopeGrantResponseSchema,
  createApplicationScopeGrantRequestSchema,
  createUserScopeGrantRequestSchema,
  listApplicationScopeGrantsResponseSchema,
  listScopeGrantsQuerySchema,
  listUserScopeGrantsResponseSchema,
  userScopeGrantResponseSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { getPrincipal } from '../../middleware/authn'
import { authorizedOrganizationIds, authorizeOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementScopeGrantsRoute = new Hono()
  .get('/users/:userId/scope-grants', async (c) => {
    const result = await listUserScopeGrants(
      getDeps(c),
      c.req.param('userId'),
      readQuery(c, listScopeGrantsQuerySchema),
      await authorizedOrganizationIds(c, 'roles:read'),
    )
    return c.json(listUserScopeGrantsResponseSchema.parse(result))
  })
  .post('/users/:userId/scope-grants', async (c) => {
    const input = await readJson(c, createUserScopeGrantRequestSchema)
    const resource = await getResource(getDeps(c), input.resourceServerId)
    await authorizeOrganization(c, input.organizationId ?? resource.ownerOrganizationId, 'roles:write')
    const grant = await createUserScopeGrant(getDeps(c), c.req.param('userId'), input, actorUserId(c))
    c.header('Location', grant.links.self)
    return c.json(userScopeGrantResponseSchema.parse(grant), 201)
  })
  .get('/users/:userId/scope-grants/:grantId', async (c) => {
    const grant = await getUserScopeGrant(getDeps(c), c.req.param('grantId'))
    if (grant.userId !== c.req.param('userId')) return c.notFound()
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'roles:read')
    return c.json(userScopeGrantResponseSchema.parse(grant))
  })
  .delete('/users/:userId/scope-grants/:grantId', async (c) => {
    const grant = await getUserScopeGrant(getDeps(c), c.req.param('grantId'))
    if (grant.userId !== c.req.param('userId')) return c.notFound()
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'roles:write')
    await revokeUserScopeGrant(getDeps(c), grant.id)
    return c.body(null, 204)
  })
  .get('/applications/:applicationId/scope-grants', async (c) => {
    const application = await requireApplication(c, 'applications:read')
    return c.json(
      listApplicationScopeGrantsResponseSchema.parse(
        await listApplicationScopeGrants(getDeps(c), application.id, readQuery(c, listScopeGrantsQuerySchema)),
      ),
    )
  })
  .post('/applications/:applicationId/scope-grants', async (c) => {
    const input = await readJson(c, createApplicationScopeGrantRequestSchema)
    const application = await requireApplication(c, 'applications:write')
    const grant = await createApplicationScopeGrant(getDeps(c), application.id, input, actorUserId(c))
    c.header('Location', grant.links.self)
    return c.json(applicationScopeGrantResponseSchema.parse(grant), 201)
  })
  .get('/applications/:applicationId/scope-grants/:grantId', async (c) => {
    const grant = await getApplicationScopeGrant(getDeps(c), c.req.param('grantId'))
    if (grant.applicationId !== c.req.param('applicationId')) return c.notFound()
    await requireApplication(c, 'applications:read')
    return c.json(applicationScopeGrantResponseSchema.parse(grant))
  })
  .delete('/applications/:applicationId/scope-grants/:grantId', async (c) => {
    const grant = await getApplicationScopeGrant(getDeps(c), c.req.param('grantId'))
    if (grant.applicationId !== c.req.param('applicationId')) return c.notFound()
    await requireApplication(c, 'applications:write')
    await revokeApplicationScopeGrant(getDeps(c), grant.id)
    return c.body(null, 204)
  })

async function requireApplication(
  c: Parameters<typeof getPrincipal>[0],
  scope: 'applications:read' | 'applications:write',
) {
  const application = await getDeps(c).applications.findById(c.req.param('applicationId')!)
  if (!application) throw notFound('Application was not found.')
  await authorizeOrganization(c, application.ownerOrganizationId, scope)
  return application
}

function actorUserId(c: Parameters<typeof getPrincipal>[0]) {
  const userId = getPrincipal(c).user?.id
  if (!userId) throw new Error('User principal is required for scope grant administration.')
  return userId
}

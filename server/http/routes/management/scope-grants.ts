import {
  createApplicationScopeGrant,
  createUserScopeGrant,
  getApplicationScopeGrant,
  getResource,
  getUserScopeGrant,
  revokeApplicationScopeGrant,
  revokeUserScopeGrant,
} from '@server/usecases/authorization'
import {
  applicationScopeGrantResponseEnvelopeSchema,
  createApplicationScopeGrantRequestSchema,
  createUserScopeGrantRequestSchema,
  userScopeGrantResponseEnvelopeSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { getPrincipal } from '../../middleware/authn'
import { authorizeOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export const managementScopeGrantsRoute = new Hono()
  .post('/user-scope-grants', async (c) => {
    const input = await readJson(c, createUserScopeGrantRequestSchema)
    const resource = await getResource(getDeps(c), input.resourceServerId)
    await authorizeOrganization(c, input.organizationId ?? resource.ownerOrganizationId, 'roles:write')
    const grant = await createUserScopeGrant(getDeps(c), input, actorUserId(c))
    c.header('Location', `/api/user-scope-grants/${encodeURIComponent(grant.id)}`)
    return c.json(userScopeGrantResponseEnvelopeSchema.parse({ grant }), 201)
  })
  .get('/user-scope-grants/:grantId', async (c) => {
    const grant = await getUserScopeGrant(getDeps(c), c.req.param('grantId'))
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'roles:read')
    return c.json(userScopeGrantResponseEnvelopeSchema.parse({ grant }))
  })
  .delete('/user-scope-grants/:grantId', async (c) => {
    const grant = await getUserScopeGrant(getDeps(c), c.req.param('grantId'))
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'roles:write')
    await revokeUserScopeGrant(getDeps(c), grant.id)
    return c.body(null, 204)
  })
  .post('/application-scope-grants', async (c) => {
    const input = await readJson(c, createApplicationScopeGrantRequestSchema)
    const application = await getDeps(c).applications.findById(input.applicationId)
    if (!application) return c.notFound()
    await authorizeOrganization(c, application.ownerOrganizationId, 'applications:write')
    const grant = await createApplicationScopeGrant(getDeps(c), input, actorUserId(c))
    c.header('Location', `/api/application-scope-grants/${encodeURIComponent(grant.id)}`)
    return c.json(applicationScopeGrantResponseEnvelopeSchema.parse({ grant }), 201)
  })
  .get('/application-scope-grants/:grantId', async (c) => {
    const grant = await getApplicationScopeGrant(getDeps(c), c.req.param('grantId'))
    const application = await getDeps(c).applications.findById(grant.applicationId)
    if (!application) return c.notFound()
    await authorizeOrganization(c, application.ownerOrganizationId, 'applications:read')
    return c.json(applicationScopeGrantResponseEnvelopeSchema.parse({ grant }))
  })
  .delete('/application-scope-grants/:grantId', async (c) => {
    const grant = await getApplicationScopeGrant(getDeps(c), c.req.param('grantId'))
    const application = await getDeps(c).applications.findById(grant.applicationId)
    if (!application) return c.notFound()
    await authorizeOrganization(c, application.ownerOrganizationId, 'applications:write')
    await revokeApplicationScopeGrant(getDeps(c), grant.id)
    return c.body(null, 204)
  })

function actorUserId(c: Parameters<typeof getPrincipal>[0]) {
  const userId = getPrincipal(c).user?.id
  if (!userId) throw new Error('User principal is required for scope grant administration.')
  return userId
}

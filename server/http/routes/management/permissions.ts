import { notFound } from '@server/domain/errors'
import {
  createApplicationPermission,
  createUserPermission,
  getApplicationPermission,
  getResource,
  getUserPermission,
  listApplicationAuthorizedResourceServers,
  listApplicationPermissions,
  listUserAuthorizedResourceServers,
  listUserPermissions,
  revokeApplicationPermission,
  revokeUserPermission,
} from '@server/usecases/authorization'
import {
  createApplicationPermissionRequestSchema,
  createUserPermissionRequestSchema,
  listApplicationPermissionsResponseSchema,
  listAuthorizedResourceServersQuerySchema,
  listAuthorizedResourceServersResponseSchema,
  listPermissionsQuerySchema,
  listUserPermissionsResponseSchema,
  permissionResponseSchema,
} from '@shared/api/authorization'
import { Hono } from 'hono'
import { getMutationActor, type getPrincipal } from '../../middleware/authn'
import { authorizedOrganizationIds, authorizeOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementPermissionsRoute = new Hono()
  .get('/users/:userId/authorized-resource-servers', async (c) => {
    const result = await listUserAuthorizedResourceServers(
      getDeps(c),
      c.req.param('userId'),
      readQuery(c, listAuthorizedResourceServersQuerySchema),
      await authorizedOrganizationIds(c, 'permissions:read'),
    )
    return c.json(listAuthorizedResourceServersResponseSchema.parse(result))
  })
  .get('/users/:userId/permissions', async (c) => {
    const result = await listUserPermissions(
      getDeps(c),
      c.req.param('userId'),
      readQuery(c, listPermissionsQuerySchema),
      await authorizedOrganizationIds(c, 'permissions:read'),
    )
    return c.json(listUserPermissionsResponseSchema.parse(result))
  })
  .post('/users/:userId/permissions', async (c) => {
    const input = await readJson(c, createUserPermissionRequestSchema)
    const resource = await getResource(getDeps(c), input.resourceServerId)
    await authorizeOrganization(c, input.organizationId ?? resource.ownerOrganizationId, 'permissions:write')
    const grant = await createUserPermission(getDeps(c), c.req.param('userId'), input, getMutationActor(c))
    c.header('Location', grant.links.self)
    return c.json(permissionResponseSchema.parse(grant), 201)
  })
  .get('/users/:userId/permissions/:permissionId', async (c) => {
    const grant = await getUserPermission(getDeps(c), c.req.param('permissionId'))
    if (grant.userId !== c.req.param('userId')) return c.notFound()
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'permissions:read')
    return c.json(permissionResponseSchema.parse(grant))
  })
  .get('/applications/:applicationId/authorized-resource-servers', async (c) => {
    const application = await requireApplication(c, 'permissions:read')
    return c.json(
      listAuthorizedResourceServersResponseSchema.parse(
        await listApplicationAuthorizedResourceServers(
          getDeps(c),
          application.id,
          readQuery(c, listAuthorizedResourceServersQuerySchema),
        ),
      ),
    )
  })
  .delete('/users/:userId/permissions/:permissionId', async (c) => {
    const grant = await getUserPermission(getDeps(c), c.req.param('permissionId'))
    if (grant.userId !== c.req.param('userId')) return c.notFound()
    const resource = await getResource(getDeps(c), grant.resourceServerId)
    await authorizeOrganization(c, grant.organizationId ?? resource.ownerOrganizationId, 'permissions:write')
    await revokeUserPermission(getDeps(c), grant.id)
    return c.body(null, 204)
  })
  .get('/applications/:applicationId/permissions', async (c) => {
    const application = await requireApplication(c, 'permissions:read')
    return c.json(
      listApplicationPermissionsResponseSchema.parse(
        await listApplicationPermissions(getDeps(c), application.id, readQuery(c, listPermissionsQuerySchema)),
      ),
    )
  })
  .post('/applications/:applicationId/permissions', async (c) => {
    const input = await readJson(c, createApplicationPermissionRequestSchema)
    const application = await requireApplication(c, 'permissions:write')
    const grant = await createApplicationPermission(getDeps(c), application.id, input, getMutationActor(c))
    c.header('Location', grant.links.self)
    return c.json(permissionResponseSchema.parse(grant), 201)
  })
  .get('/applications/:applicationId/permissions/:permissionId', async (c) => {
    const grant = await getApplicationPermission(getDeps(c), c.req.param('permissionId'))
    if (grant.applicationId !== c.req.param('applicationId')) return c.notFound()
    await requireApplication(c, 'permissions:read')
    return c.json(permissionResponseSchema.parse(grant))
  })
  .delete('/applications/:applicationId/permissions/:permissionId', async (c) => {
    const grant = await getApplicationPermission(getDeps(c), c.req.param('permissionId'))
    if (grant.applicationId !== c.req.param('applicationId')) return c.notFound()
    await requireApplication(c, 'permissions:write')
    await revokeApplicationPermission(getDeps(c), grant.id)
    return c.body(null, 204)
  })

async function requireApplication(
  c: Parameters<typeof getPrincipal>[0],
  scope: 'permissions:read' | 'permissions:write',
) {
  const application = await getDeps(c).applications.findById(c.req.param('applicationId')!)
  if (!application) throw notFound('Application was not found.')
  await authorizeOrganization(c, application.ownerOrganizationId, scope)
  return application
}

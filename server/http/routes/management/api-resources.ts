import { badRequest } from '@server/domain/errors'
import { platformOrganization } from '@server/domain/platform-organization'
import {
  createResource,
  deleteResource,
  getResourceContract,
  refreshResourceScopeRegistry,
  updateResource,
} from '@server/usecases/authorization'
import {
  getAgentResourceServer,
  getApiResource,
  listAgentResourceServers,
  listApiResources,
} from '@server/usecases/external-resources'
import {
  createApiResourceSchema,
  resourceServerSchema,
  resourceServersResponseSchema,
  updateApiResourceSchema,
} from '@shared/api/agent-api'
import { apiResourceContractResponseSchema, listApiResourcesQuerySchema } from '@shared/api/authorization'
import { Hono } from 'hono'
import type { AppConfig } from '../../app-types'
import { getMutationActor, getPrincipal } from '../../middleware/authn'
import {
  authorizedOrganizationIds,
  authorizedOrganizationOwnerId,
  authorizeOrganization,
  authorizeOrganizationOwner,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { trustedRequestOrigin } from '../../trusted-request-origin'
import { readJson, readQuery } from '../validation'

export function createManagementApiResourcesRoute(config: Pick<AppConfig, 'baseURL' | 'trustedOrigins'> = {}) {
  const app = new Hono()

  app.get('/', async (c) => {
    const origin = trustedRequestOrigin(config, c.req.url)
    const principal = getPrincipal(c).agent
    if (principal && !principal.authority) {
      return c.json(
        await listAgentResourceServers(
          getDeps(c),
          principal,
          readQuery(c, listApiResourcesQuerySchema.pick({ limit: true, offset: true })),
          origin,
        ),
      )
    }
    const query = readQuery(c, listApiResourcesQuerySchema)
    return c.json(
      resourceServersResponseSchema.parse(
        await listApiResources(
          getDeps(c),
          query,
          origin,
          await filterOrganizationSelection(c, query.ownerOrganizationId),
        ),
      ),
    )
  })

  app.post('/', async (c) => {
    const input = await readJson(c, createApiResourceSchema)
    if (input.connectorId && input.ownerOrganizationId !== platformOrganization.id) {
      throw badRequest('External Resource Servers must be owned by the built-in platform Organization.')
    }
    const owner = await authorizeOrganizationOwner(c, input.ownerOrganizationId, 'resource-servers:write')
    const resource = await createResource(getDeps(c), {
      ...input,
      ownerOrganizationId: authorizedOrganizationOwnerId(owner),
    })
    c.header('Location', `/api/resource-servers/${encodeURIComponent(resource.id)}`)
    return c.json(
      resourceServerSchema.parse(
        await getApiResource(getDeps(c), resource.id, trustedRequestOrigin(config, c.req.url)),
      ),
      201,
    )
  })

  app.get('/:resourceId', async (c) => {
    const principal = getPrincipal(c).agent
    if (principal && !principal.authority) {
      return c.json(
        await getAgentResourceServer(
          getDeps(c),
          c.req.param('resourceId'),
          principal,
          trustedRequestOrigin(config, c.req.url),
        ),
      )
    }
    return c.json(resourceServerSchema.parse(await requireResourceAccess(c, config)))
  })

  app.get('/:resourceId/contract', async (c) => {
    await requireResourceAccess(c, config)
    return c.json(
      apiResourceContractResponseSchema.parse(await getResourceContract(getDeps(c), c.req.param('resourceId'))),
    )
  })

  app.patch('/:resourceId', async (c) => {
    const resource = await requireResourceAccess(c, config)
    const input = await readJson(c, updateApiResourceSchema)
    if (resource.connectorId && input.ownerOrganizationId && input.ownerOrganizationId !== platformOrganization.id) {
      throw badRequest('External Resource Servers must be owned by the built-in platform Organization.')
    }
    const owner = input.ownerOrganizationId
      ? await authorizeOrganizationOwner(c, input.ownerOrganizationId, 'resource-servers:write')
      : null
    await updateResource(getDeps(c), c.req.param('resourceId'), {
      ...input,
      ...(owner ? { ownerOrganizationId: authorizedOrganizationOwnerId(owner) } : {}),
    })
    return c.json(
      resourceServerSchema.parse(
        await getApiResource(getDeps(c), c.req.param('resourceId'), trustedRequestOrigin(config, c.req.url)),
      ),
    )
  })

  app.delete('/:resourceId', async (c) => {
    await requireResourceAccess(c, config)
    await deleteResource(getDeps(c), c.req.param('resourceId'), getMutationActor(c))
    return c.body(null, 204)
  })

  return app.put('/:resourceId/scope-registry', async (c) => {
    await requireResourceAccess(c, config)
    await refreshResourceScopeRegistry(getDeps(c), c.req.param('resourceId'))
    return c.json(
      resourceServerSchema.parse(
        await getApiResource(getDeps(c), c.req.param('resourceId'), trustedRequestOrigin(config, c.req.url)),
      ),
    )
  })
}

async function requireResourceAccess(
  c: Parameters<typeof getPrincipal>[0],
  config: Pick<AppConfig, 'baseURL' | 'trustedOrigins'>,
) {
  const resource = await getApiResource(getDeps(c), c.req.param('resourceId')!, trustedRequestOrigin(config, c.req.url))
  await authorizeOrganization(
    c,
    resource.ownerOrganizationId,
    c.req.method === 'GET' || c.req.method === 'HEAD' ? 'resource-servers:read' : 'resource-servers:write',
  )
  return resource
}

async function filterOrganizationSelection(c: Parameters<typeof getPrincipal>[0], requestedOrganizationId?: string) {
  const allowed = await authorizedOrganizationIds(c, 'resource-servers:read')
  if (!allowed) return requestedOrganizationId ? [requestedOrganizationId] : undefined
  if (!requestedOrganizationId) return allowed
  return allowed.includes(requestedOrganizationId) ? [requestedOrganizationId] : []
}

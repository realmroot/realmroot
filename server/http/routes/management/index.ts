import { assignApplicationRole, assignMemberRole, assignUserRole } from '@server/usecases/authorization'
import { assignRoleRequestSchema } from '@shared/api/authorization'
import type { SecurityPolicy } from '@shared/api/security'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getActorUserId } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import type { ManagementAuthApi } from '../auth-api'
import { readJson } from '../validation'
import { managementAgentsRoute } from './agents'
import { managementApiResourcesRoute } from './api-resources'
import { managementApplicationsRoute } from './applications'
import { createManagementConnectorRoutes } from './connectors'
import { managementOrganizationsRoute } from './organizations'
import { createManagementReadinessRoute } from './readiness'
import { managementRolesRoute } from './roles'
import { managementSecurityRoutes } from './security'
import { createManagementSettingsRoutes } from './settings'
import { managementUserRoutes } from './users'
import { createManagementWebhookRoutes } from './webhooks'

interface ManagementRoutesOptions {
  authApi: ManagementAuthApi
  securityPolicy?: SecurityPolicy
}

export function createManagementRoutes(options: ManagementRoutesOptions) {
  const app = new Hono()

  app.route('/applications', managementApplicationsRoute)
  app.route('/api-resources', managementApiResourcesRoute)
  app.route('/', managementAgentsRoute)
  app.route('/organizations', managementOrganizationsRoute)
  app.route('/roles', managementRolesRoute)
  app.post('/user-role-assignments', requireAdmin(), async (c) => {
    await assignUserRole(getDeps(c), await readJson(c, assignRoleRequestSchema), getActorUserId(c))
    return c.body(null, 204)
  })
  app.post('/application-role-assignments', requireAdmin(), async (c) => {
    await assignApplicationRole(getDeps(c), await readJson(c, assignRoleRequestSchema), getActorUserId(c))
    return c.body(null, 204)
  })
  app.post('/member-role-assignments', requireAdmin(), async (c) => {
    await assignMemberRole(getDeps(c), await readJson(c, assignRoleRequestSchema), getActorUserId(c))
    return c.body(null, 204)
  })

  app.route('/users', managementUserRoutes(options.authApi, { normalizeListResponse: true }))
  app.route('/security', managementSecurityRoutes(options.authApi))

  app.route('/', createManagementSettingsRoutes(options.securityPolicy))
  app.route('/', createManagementReadinessRoute({ securityPolicy: options.securityPolicy }))
  app.route('/connectors', createManagementConnectorRoutes())
  app.route('/webhooks', createManagementWebhookRoutes())

  return app
}

export type ManagementRoutes = ReturnType<typeof createManagementRoutes>

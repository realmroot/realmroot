import type { Context } from 'hono'
import { Hono } from 'hono'
import { assignRoleRequestSchema } from '../../../shared/api/authorization'
import {
  type ManagementSignInSettingsResponse,
  managementSignInSettingsResponseSchema,
} from '../../../shared/api/management'
import type { SecurityPolicy } from '../../../shared/api/security'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { type AuthorizationBindings, createAuthorizationService } from '../../modules/authorization/context'
import { createExperienceService, type ExperienceBindings } from '../../modules/experience/context'
import type { SecurityRepository } from '../../modules/security/repository'
import type { UserRepository } from '../../modules/users/repository'
import { adminApiResourcesRoute } from '../admin/api-resources'
import { adminApplicationsRoute } from '../admin/applications'
import { adminOrganizationsRoute } from '../admin/organizations'
import { adminRolesRoute } from '../admin/roles'
import { adminSecurityRoutes } from '../admin/security'
import { adminUserRoutes } from '../admin/users'
import type { ManagementAuthApi } from '../auth-api'
import { readJson } from '../validation'
import { type ConnectorServiceFactory, createManagementConnectorRoutes } from './connectors'

interface ManagementExperienceConfig {
  signIn: ManagementSignInSettingsResponse['signIn']
  defaults: ManagementSignInSettingsResponse['defaults']
  links: ManagementSignInSettingsResponse['links']
}

export type ManagementExperienceServiceFactory = (c: Context<{ Bindings: ExperienceBindings }>) => {
  getConfig: () => Promise<ManagementExperienceConfig>
  getCallbackState: (query: unknown) => Promise<unknown>
}

interface ManagementRoutesOptions {
  authApi: ManagementAuthApi
  userRepository?: UserRepository
  securityRepository?: SecurityRepository
  securityPolicy?: SecurityPolicy
  experienceServiceFactory?: ManagementExperienceServiceFactory
  connectorServiceFactory?: ConnectorServiceFactory
}

export function createManagementRoutes(options: ManagementRoutesOptions) {
  const app = new Hono<{ Bindings: AuthorizationBindings & ExperienceBindings }>()

  app.route('/applications', adminApplicationsRoute)
  app.route('/api-resources', adminApiResourcesRoute)
  app.route('/organizations', adminOrganizationsRoute)
  app.route('/roles', adminRolesRoute)
  app.post('/user-role-assignments', requireAdmin(), async (c) => {
    const { user } = getAuthContext(c)
    await createAuthorizationService(c).assignUserRole(await readJson(c, assignRoleRequestSchema), user?.id ?? null)
    return c.body(null, 204)
  })
  app.post('/application-role-assignments', requireAdmin(), async (c) => {
    const { user } = getAuthContext(c)
    await createAuthorizationService(c).assignApplicationRole(
      await readJson(c, assignRoleRequestSchema),
      user?.id ?? null,
    )
    return c.body(null, 204)
  })
  app.post('/member-role-assignments', requireAdmin(), async (c) => {
    const { user } = getAuthContext(c)
    await createAuthorizationService(c).assignMemberRole(await readJson(c, assignRoleRequestSchema), user?.id ?? null)
    return c.body(null, 204)
  })

  if (options.userRepository) {
    app.route('/users', adminUserRoutes(options.authApi, options.userRepository, { normalizeListResponse: true }))
  }

  if (options.userRepository && options.securityRepository && options.securityPolicy) {
    app.route(
      '/security',
      adminSecurityRoutes(options.authApi, options.userRepository, options.securityRepository, options.securityPolicy),
    )
  }

  {
    const experienceServiceFactory = options.experienceServiceFactory ?? createExperienceService

    app.use('/sign-in-settings', requireAdmin())

    app.get('/sign-in-settings', async (c) => {
      const config = await experienceServiceFactory(c).getConfig()
      const response = {
        signIn: config.signIn,
        defaults: config.defaults,
        links: config.links,
      } satisfies ManagementSignInSettingsResponse

      return c.json(managementSignInSettingsResponseSchema.parse(response))
    })
  }

  app.route('/connectors', createManagementConnectorRoutes(options.connectorServiceFactory))

  return app
}

export type ManagementRoutes = ReturnType<typeof createManagementRoutes>

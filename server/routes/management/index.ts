import type { Context } from 'hono'
import { Hono } from 'hono'
import { assignRoleRequestSchema } from '../../../shared/api/authorization'
import {
  type ManagementBrandingSettingsResponse,
  type ManagementReadinessResponse,
  type ManagementSignInSettingsResponse,
  managementBrandingSettingsResponseSchema,
  managementReadinessResponseSchema,
  managementSignInSettingsResponseSchema,
  type UpdateManagementBrandingSettingsRequest,
  type UpdateManagementSignInSettingsRequest,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '../../../shared/api/management'
import type { SecurityPolicy } from '../../../shared/api/security'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { type ApplicationBindings, createApplicationService } from '../../modules/applications/context'
import { type AuthorizationBindings, createAuthorizationService } from '../../modules/authorization/context'
import { type ConfigzBindings, createConfigzService } from '../../modules/configz/context'
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

interface ManagementConfigz {
  signIn: ManagementSignInSettingsResponse['signIn']
  defaults: ManagementSignInSettingsResponse['defaults']
  links: ManagementSignInSettingsResponse['links']
  copy: ManagementSignInSettingsResponse['copy']
  branding: ManagementBrandingSettingsResponse['branding']
  getManagementSignInSettings?: () => Promise<ManagementSignInSettingsResponse>
  updateManagementSignInSettings?: (
    input: UpdateManagementSignInSettingsRequest,
  ) => Promise<ManagementSignInSettingsResponse>
  getManagementBrandingSettings?: () => Promise<ManagementBrandingSettingsResponse>
  updateManagementBrandingSettings?: (
    input: UpdateManagementBrandingSettingsRequest,
  ) => Promise<ManagementBrandingSettingsResponse>
}

export type ManagementConfigzServiceFactory = (c: Context<{ Bindings: ConfigzBindings }>) => {
  getConfig: () => Promise<ManagementConfigz>
  getManagementSignInSettings?: () => Promise<ManagementSignInSettingsResponse>
  updateManagementSignInSettings?: (
    input: UpdateManagementSignInSettingsRequest,
  ) => Promise<ManagementSignInSettingsResponse>
  getManagementBrandingSettings?: () => Promise<ManagementBrandingSettingsResponse>
  updateManagementBrandingSettings?: (
    input: UpdateManagementBrandingSettingsRequest,
  ) => Promise<ManagementBrandingSettingsResponse>
}

export type ManagementApplicationServiceFactory = (c: Context<{ Bindings: ApplicationBindings }>) => {
  list: (query: { limit: number; offset: number }) => Promise<{ pagination: { total: number } }>
  revokeConsent: (consentId: string, userId: string) => Promise<void>
}

interface ManagementRoutesOptions {
  authApi: ManagementAuthApi
  userRepository?: UserRepository
  securityRepository?: SecurityRepository
  securityPolicy?: SecurityPolicy
  configzServiceFactory?: ManagementConfigzServiceFactory
  applicationServiceFactory?: ManagementApplicationServiceFactory
  connectorServiceFactory?: ConnectorServiceFactory
}

export function createManagementRoutes(options: ManagementRoutesOptions) {
  const app = new Hono<{ Bindings: AuthorizationBindings & ConfigzBindings & ApplicationBindings }>()

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
    const configzServiceFactory = options.configzServiceFactory ?? createConfigzService

    app.use('/sign-in-settings', requireAdmin())

    app.get('/sign-in-settings', async (c) => {
      const service = configzServiceFactory(c)
      const response = service.getManagementSignInSettings
        ? await service.getManagementSignInSettings()
        : await managementSignInSettingsFromConfig(await service.getConfig())

      return c.json(managementSignInSettingsResponseSchema.parse(response))
    })

    app.patch('/sign-in-settings', async (c) => {
      const input = await readJson(c, updateManagementSignInSettingsRequestSchema)
      const service = configzServiceFactory(c)
      const response = service.updateManagementSignInSettings
        ? await service.updateManagementSignInSettings(input)
        : await managementSignInSettingsFromConfig(await service.getConfig())

      return c.json(managementSignInSettingsResponseSchema.parse(response))
    })

    app.use('/branding-settings', requireAdmin())

    app.get('/branding-settings', async (c) => {
      const service = configzServiceFactory(c)
      const response = service.getManagementBrandingSettings
        ? await service.getManagementBrandingSettings()
        : await managementBrandingSettingsFromConfig(await service.getConfig())

      return c.json(managementBrandingSettingsResponseSchema.parse(response))
    })

    app.patch('/branding-settings', async (c) => {
      const input = await readJson(c, updateManagementBrandingSettingsRequestSchema)
      const service = configzServiceFactory(c)
      const response = service.updateManagementBrandingSettings
        ? await service.updateManagementBrandingSettings(input)
        : await managementBrandingSettingsFromConfig(await service.getConfig())

      return c.json(managementBrandingSettingsResponseSchema.parse(response))
    })
  }

  {
    const applicationServiceFactory = options.applicationServiceFactory ?? createApplicationService

    app.use('/readiness', requireAdmin())

    app.get('/readiness', async (c) => {
      const applications = await applicationServiceFactory(c).list({ limit: 1, offset: 0 })
      const missing: ManagementReadinessResponse['admin']['missing'] =
        applications.pagination.total === 0 ? ['oidc_application'] : []
      const response = {
        admin: {
          setupRequired: missing.length > 0,
          setupHref: '/admin/onboarding',
          missing,
        },
      } satisfies ManagementReadinessResponse

      return c.json(managementReadinessResponseSchema.parse(response))
    })
  }

  app.route('/connectors', createManagementConnectorRoutes(options.connectorServiceFactory))

  return app
}

export type ManagementRoutes = ReturnType<typeof createManagementRoutes>

async function managementSignInSettingsFromConfig(
  config: Awaited<ReturnType<ReturnType<ManagementConfigzServiceFactory>['getConfig']>>,
): Promise<ManagementSignInSettingsResponse> {
  return {
    signIn: config.signIn,
    defaults: config.defaults,
    links: config.links,
    copy: config.copy,
  }
}

async function managementBrandingSettingsFromConfig(
  config: Awaited<ReturnType<ReturnType<ManagementConfigzServiceFactory>['getConfig']>>,
): Promise<ManagementBrandingSettingsResponse> {
  return {
    branding: config.branding,
    copy: config.copy,
  }
}

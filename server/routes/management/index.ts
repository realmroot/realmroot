import { Hono } from 'hono'
import { assignRoleRequestSchema } from '../../../shared/api/authorization'
import type { SecurityPolicy } from '../../../shared/api/security'
import type { TokenExchangeServiceFactory } from '../../app'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import type { AgentBindings } from '../../modules/agents/context'
import type { ApplicationBindings } from '../../modules/applications/context'
import { type AuthorizationBindings, createAuthorizationService } from '../../modules/authorization/context'
import type { ConfigzBindings } from '../../modules/configz/context'
import type { SecurityRepository } from '../../modules/security/repository'
import type { UserRepository } from '../../modules/users/repository'
import type { ManagementAuthApi } from '../auth-api'
import { readJson } from '../validation'
import { managementAgentsRoute } from './agents'
import { managementApiResourcesRoute } from './api-resources'
import { managementApplicationsRoute } from './applications'
import { type ConnectorServiceFactory, createManagementConnectorRoutes } from './connectors'
import { managementOrganizationsRoute } from './organizations'
import { createManagementReadinessRoute, type ManagementApplicationServiceFactory } from './readiness'
import { managementRolesRoute } from './roles'
import { managementSecurityRoutes } from './security'
import { createManagementSettingsRoutes, type ManagementConfigzServiceFactory } from './settings'
import { createTrustedIssuerRoutes } from './trusted-issuers'
import { managementUserRoutes } from './users'
import { createManagementWebhookRoutes, type WebhookServiceFactory } from './webhooks'

export type { ManagementApplicationServiceFactory } from './readiness'
export type { ManagementConfigzServiceFactory } from './settings'

interface ManagementBindings extends AuthorizationBindings, ConfigzBindings, ApplicationBindings, AgentBindings {
  EMAIL?: unknown
  EMAIL_FROM?: string
}

interface ManagementRoutesOptions {
  authApi: ManagementAuthApi
  userRepository?: UserRepository
  securityRepository?: SecurityRepository
  securityPolicy?: SecurityPolicy
  configzServiceFactory?: ManagementConfigzServiceFactory
  applicationServiceFactory?: ManagementApplicationServiceFactory
  connectorServiceFactory?: ConnectorServiceFactory
  webhookServiceFactory?: WebhookServiceFactory
  tokenExchangeServiceFactory?: TokenExchangeServiceFactory
}

export function createManagementRoutes(options: ManagementRoutesOptions) {
  const app = new Hono<{ Bindings: ManagementBindings }>()

  app.route('/applications', managementApplicationsRoute)
  app.route('/api-resources', managementApiResourcesRoute)
  app.route('/', managementAgentsRoute)
  app.route('/organizations', managementOrganizationsRoute)
  app.route('/roles', managementRolesRoute)
  app.route('/trusted-issuers', createTrustedIssuerRoutes(options.tokenExchangeServiceFactory))
  app.post('/user-role-assignments', requireAdmin(), async (c) => {
    const { user } = getAuthContext(c)
    await createAuthorizationService(c).assignUserRole(await readJson(c, assignRoleRequestSchema), user!.id)
    return c.body(null, 204)
  })
  app.post('/application-role-assignments', requireAdmin(), async (c) => {
    const { user } = getAuthContext(c)
    await createAuthorizationService(c).assignApplicationRole(await readJson(c, assignRoleRequestSchema), user!.id)
    return c.body(null, 204)
  })
  app.post('/member-role-assignments', requireAdmin(), async (c) => {
    const { user } = getAuthContext(c)
    await createAuthorizationService(c).assignMemberRole(await readJson(c, assignRoleRequestSchema), user!.id)
    return c.body(null, 204)
  })

  if (options.userRepository) {
    app.route(
      '/users',
      managementUserRoutes(options.authApi, options.userRepository, {
        normalizeListResponse: true,
        securityRepository: options.securityRepository,
      }),
    )
  }

  if (options.userRepository && options.securityRepository && options.securityPolicy) {
    app.route(
      '/security',
      managementSecurityRoutes(options.authApi, options.userRepository, options.securityRepository),
    )
  }

  app.route('/', createManagementSettingsRoutes(options.configzServiceFactory))
  app.route(
    '/',
    createManagementReadinessRoute({
      applicationServiceFactory: options.applicationServiceFactory,
      configzServiceFactory: options.configzServiceFactory,
      securityPolicy: options.securityPolicy,
    }),
  )
  app.route('/connectors', createManagementConnectorRoutes(options.connectorServiceFactory))
  app.route('/webhooks', createManagementWebhookRoutes(options.webhookServiceFactory))

  return app
}

export type ManagementRoutes = ReturnType<typeof createManagementRoutes>

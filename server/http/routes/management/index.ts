import type { SecurityPolicy } from '@shared/api/security'
import { Hono, type MiddlewareHandler } from 'hono'
import type { ManagementAuthApi } from '../auth-api'
import { managementAgentsRoute } from './agents'
import { createManagementApiResourcesRoute } from './api-resources'
import { managementApplicationsRoute } from './applications'
import { createManagementConnectorRoutes } from './connectors'
import { managementOrganizationsRoute } from './organizations'
import { managementPermissionsRoute } from './permissions'
import { createManagementReadinessRoute } from './readiness'
import { managementSecurityRoutes } from './security'
import { createManagementSettingsRoutes } from './settings'
import { managementUserRoutes } from './users'
import { createManagementWebhookRoutes } from './webhooks'

interface ProtectedResourceRoutesOptions {
  authApi: ManagementAuthApi
  canonicalOrigin?: string
  trustedOrigins?: string[]
  securityPolicy?: SecurityPolicy
}

export function createProtectedResourceRoutes(options: ProtectedResourceRoutesOptions) {
  const app = new Hono()
  const agentsCanonicalOrigin: MiddlewareHandler = async (c, next) => {
    if (options.canonicalOrigin) c.set('realmrootCanonicalOrigin', options.canonicalOrigin)
    await next()
  }

  app.route('/applications', managementApplicationsRoute)
  app.route(
    '/resource-servers',
    createManagementApiResourcesRoute({ baseURL: options.canonicalOrigin, trustedOrigins: options.trustedOrigins }),
  )
  app.route('/', managementPermissionsRoute)
  app.use('/agents', agentsCanonicalOrigin)
  app.use('/agents/*', agentsCanonicalOrigin)
  app.route('/', managementAgentsRoute)
  app.route('/organizations', managementOrganizationsRoute)
  app.route('/users', managementUserRoutes(options.authApi, { normalizeListResponse: true }))
  app.route('/realm/security-policy', managementSecurityRoutes())

  app.route('/', createManagementSettingsRoutes(options.securityPolicy))
  app.route('/', createManagementReadinessRoute({ securityPolicy: options.securityPolicy }))
  app.route('/connectors', createManagementConnectorRoutes(options.canonicalOrigin))
  app.route('/webhooks', createManagementWebhookRoutes())

  return app
}

export type ProtectedResourceRoutes = ReturnType<typeof createProtectedResourceRoutes>

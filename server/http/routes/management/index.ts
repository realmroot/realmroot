import type { SecurityPolicy } from '@shared/api/security'
import { Hono } from 'hono'
import type { ManagementAuthApi } from '../auth-api'
import { managementAgentsRoute } from './agents'
import { createManagementApiResourcesRoute } from './api-resources'
import { managementApplicationAuthorizationsRoute, managementApplicationsRoute } from './applications'
import { createManagementConnectorRoutes } from './connectors'
import { managementOrganizationsRoute } from './organizations'
import { createManagementReadinessRoute } from './readiness'
import { managementScopeGrantsRoute } from './scope-grants'
import { managementSecurityRoutes } from './security'
import { createManagementSettingsRoutes } from './settings'
import { managementUserRoutes } from './users'
import { createManagementWebhookRoutes } from './webhooks'

interface ProtectedResourceRoutesOptions {
  authApi: ManagementAuthApi
  canonicalOrigin?: string
  securityPolicy?: SecurityPolicy
}

export function createProtectedResourceRoutes(options: ProtectedResourceRoutesOptions) {
  const app = new Hono()

  app.route('/applications', managementApplicationsRoute)
  app.route('/access/consents', managementApplicationAuthorizationsRoute)
  app.route('/resource-servers', createManagementApiResourcesRoute())
  app.route('/', managementScopeGrantsRoute)
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

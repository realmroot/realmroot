import type { Context } from 'hono'
import { Hono } from 'hono'
import { assignRoleRequestSchema } from '../../../shared/api/authorization'
import {
  type ManagementBrandingSettingsResponse,
  type ManagementReadinessItem,
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

interface ManagementBindings extends AuthorizationBindings, ConfigzBindings, ApplicationBindings {
  EMAIL?: unknown
  EMAIL_FROM?: string
}

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
  const app = new Hono<{ Bindings: ManagementBindings }>()

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
    app.route(
      '/users',
      adminUserRoutes(options.authApi, options.userRepository, {
        normalizeListResponse: true,
        securityRepository: options.securityRepository,
      }),
    )
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
    const configzServiceFactory = options.configzServiceFactory ?? createConfigzService

    app.use('/readiness', requireAdmin())

    app.get('/readiness', async (c) => {
      const [applications, config] = await Promise.all([
        applicationServiceFactory(c).list({ limit: 1, offset: 0 }),
        configzServiceFactory(c).getConfig(),
      ])
      const hasOidcApplication = applications.pagination.total > 0
      const identityProviderCount =
        'identityProviders' in config && Array.isArray(config.identityProviders) ? config.identityProviders.length : 0
      const hasSocialSignInMethod = config.signIn.socialLoginEnabled && identityProviderCount > 0
      const hasSignInMethod =
        config.signIn.passwordEnabled ||
        config.signIn.magicLinkEnabled ||
        config.signIn.emailOtpEnabled ||
        hasSocialSignInMethod
      const emailMethodsEnabled =
        config.signIn.magicLinkEnabled || config.signIn.emailOtpEnabled || config.signIn.signupEnabled
      const emailDeliveryReady = !emailMethodsEnabled || (Boolean(c.env?.EMAIL) && Boolean(c.env?.EMAIL_FROM))
      const brandingReady =
        config.copy.productName !== 'FlareAuth' ||
        Boolean(config.branding.logoUrl || config.branding.faviconUrl || config.branding.primaryColor)
      const securityReady = Boolean(
        options.securityPolicy?.mfa.mode === 'required' || options.securityPolicy?.passkeys.enabled,
      )
      const connectorReady = !config.signIn.socialLoginEnabled || hasSocialSignInMethod
      const required = [
        readinessItem({
          id: 'oidc_application',
          label: 'Create an OIDC application',
          description: 'Register the first client so product routes can complete authorization code flows.',
          complete: hasOidcApplication,
          href: '/admin/onboarding',
          action: 'Create client',
        }),
        readinessItem({
          id: 'sign_in_method',
          label: 'Enable a sign-in method',
          description: 'Keep at least one hosted sign-in method available for users.',
          complete: hasSignInMethod,
          href: '/admin/sign-in',
          action: 'Review methods',
        }),
      ]
      const recommended = [
        readinessItem({
          id: 'email_delivery',
          label: 'Confirm email delivery',
          description:
            'Email binding and sender settings are needed for verification, OTP, magic link, and reset flows.',
          complete: emailDeliveryReady,
          href: '/admin/deployment',
          action: 'Review deployment',
        }),
        readinessItem({
          id: 'branding_basics',
          label: 'Set branding basics',
          description: 'Product name, colors, logo, and favicon make hosted auth recognizable to users.',
          complete: brandingReady,
          href: '/admin/branding',
          action: 'Edit branding',
        }),
        readinessItem({
          id: 'security_baseline',
          label: 'Review security baseline',
          description: 'MFA or passkeys should be enabled before production rollout.',
          complete: securityReady,
          href: '/admin/security',
          action: 'Review security',
        }),
        readinessItem({
          id: 'connector_status',
          label: 'Check connector status',
          description: 'Social sign-in should have at least one enabled connector, or stay disabled until configured.',
          complete: connectorReady,
          href: '/admin/connectors',
          action: 'Review connectors',
        }),
      ]
      const missing = required
        .filter((item) => item.status === 'action_needed')
        .map((item) => item.id) satisfies ManagementReadinessResponse['admin']['missing']
      const response = {
        required,
        recommended,
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

function readinessItem(input: {
  id: ManagementReadinessItem['id']
  label: string
  description: string
  complete: boolean
  href: string
  action: string
}): ManagementReadinessItem {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    status: input.complete ? 'complete' : 'action_needed',
    href: input.href,
    action: input.action,
  }
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

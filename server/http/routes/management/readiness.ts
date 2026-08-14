import { listApplications } from '@server/usecases/applications'
import { getConfig, getEmailDeliveryConfiguration } from '@server/usecases/configz'
import {
  type ManagementReadinessItem,
  type ManagementReadinessResponse,
  managementReadinessResponseSchema,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { configzOptions } from '../../app-config'
import { authorizePlatformOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'

interface ReadinessBindings {
  EMAIL?: unknown
}

export function createManagementReadinessRoute({ securityPolicy }: { securityPolicy?: SecurityPolicy }) {
  const app = new Hono<{ Bindings: ReadinessBindings }>()

  app.use('/realm/configuration-status', async (c, next) => {
    await authorizePlatformOrganization(c, 'readiness:read')
    await next()
  })

  app.get('/realm/configuration-status', async (c) => {
    const deps = getDeps(c)
    const options = configzOptions(c, securityPolicy)
    const [applications, config, emailSettings] = await Promise.all([
      listApplications(deps, issuerFor(c), { limit: 100, offset: 0 }),
      getConfig(deps, options),
      getEmailDeliveryConfiguration(deps, options),
    ])
    const hasOidcApplication = applications.items.length > 0
    const identityProviderCount =
      'identityProviders' in config && Array.isArray(config.identityProviders) ? config.identityProviders.length : 0
    const hasSocialSignInMethod = config.signIn.socialLoginEnabled && identityProviderCount > 0
    const hasSignInMethod = config.signIn.passwordEnabled || config.signIn.emailOtpEnabled || hasSocialSignInMethod
    const emailMethodsEnabled = config.signIn.emailOtpEnabled || config.signIn.signupEnabled
    const emailDeliveryReady =
      !emailMethodsEnabled ||
      (emailSettings.enabled && emailSettings.bindingAvailable && Boolean(emailSettings.fromEmail))
    const brandingReady =
      config.copy.productName !== 'Realmroot' ||
      Boolean(config.branding.logoUrl || config.branding.faviconUrl || config.branding.primaryColor)
    const securityReady = Boolean(securityPolicy?.mfa.mode === 'required' || securityPolicy?.passkeys.enabled)
    const connectorReady = !config.signIn.socialLoginEnabled || hasSocialSignInMethod
    const required = [
      readinessItem({
        id: 'oidc_application',
        label: 'Create an OIDC application',
        description: 'Register the first client so product routes can complete authorization code flows.',
        complete: hasOidcApplication,
        href: '/console/applications',
        action: 'Create client',
      }),
      readinessItem({
        id: 'sign_in_method',
        label: 'Enable a sign-in method',
        description: 'Keep at least one hosted sign-in method available for users.',
        complete: hasSignInMethod,
        href: '/console/sign-in-experience/sign-in',
        action: 'Review methods',
      }),
    ]
    const recommended = [
      readinessItem({
        id: 'email_delivery',
        label: 'Confirm email delivery',
        description: 'Email binding and sender settings are needed for verification, OTP, and reset flows.',
        complete: emailDeliveryReady,
        href: '/console/tenant-settings/email',
        action: 'Configure delivery',
      }),
      readinessItem({
        id: 'branding_basics',
        label: 'Set branding basics',
        description: 'Product name, colors, logo, and favicon make hosted auth recognizable to users.',
        complete: brandingReady,
        href: '/console/sign-in-experience/theme',
        action: 'Edit branding',
      }),
      readinessItem({
        id: 'security_baseline',
        label: 'Review security baseline',
        description: 'MFA or passkeys should be enabled before production rollout.',
        complete: securityReady,
        href: '/console/security/mfa',
        action: 'Review security',
      }),
      readinessItem({
        id: 'connector_status',
        label: 'Check connector status',
        description: 'Social sign-in should have at least one enabled connector, or stay disabled until configured.',
        complete: connectorReady,
        href: '/console/connectors',
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
        setupHref: '/console/applications',
        missing,
      },
    } satisfies ManagementReadinessResponse

    return c.json(managementReadinessResponseSchema.parse(response))
  })

  return app
}

function issuerFor(c: Context) {
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
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

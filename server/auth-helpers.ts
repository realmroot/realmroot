import type { TransactionalEmailSender } from '@server/adapters/gateways/email/sender'
import { type AuthorizationTokenClaimInput, buildTokenClaims } from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import {
  applicationEffectiveResourceScopes,
  userEffectiveResourceScopes,
} from '@server/usecases/resource-scope-entitlements'
import { resourceVisibleToOrganization } from '@server/usecases/resource-visibility'
import { userConfigurableApplicationScopes } from '@shared/api/applications'
import { realmrootOrganizationClaim } from '@shared/oauth-token-profile'
import { APIError } from 'better-auth'
import type { ManagementSignInSettingsResponse } from '../shared/api/management'

export function siweDomain(baseURL: string, configuredDomain: string) {
  if (configuredDomain.trim()) return configuredDomain.trim()
  return new URL(baseURL).host
}

export function createNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function sendPasswordChangedNotification(emailSender: TransactionalEmailSender, email: string) {
  void emailSender
    .send({
      to: email,
      template: {
        type: 'security-notification',
        title: 'Your password was changed',
        body: 'Your Realmroot password was changed. If this was not you, reset your password immediately.',
      },
    })
    .catch((error: unknown) => {
      console.error('Failed to send password changed notification.', error)
    })
}

export async function sendSmsOtp(
  config: ManagementSignInSettingsResponse['builtInProviders']['phone'] | undefined,
  phoneNumber: string,
  code: string,
) {
  if (!config) throw new Error('Phone provider is not configured.')

  if (config.smsProvider === 'twilio') {
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
      throw new Error('Twilio SMS provider is not configured.')
    }
    const body = new URLSearchParams({
      To: phoneNumber,
      From: config.twilioFromNumber,
      Body: `Your verification code is ${code}`,
    })
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${config.twilioAccountSid}:${config.twilioAuthToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    )
    if (!response.ok) throw new Error('Twilio SMS delivery failed.')
    return
  }

  if (config.smsProvider === 'vonage') {
    if (!config.vonageApiKey || !config.vonageApiSecret || !config.vonageFrom) {
      throw new Error('Vonage SMS provider is not configured.')
    }
    const body = new URLSearchParams({
      api_key: config.vonageApiKey,
      api_secret: config.vonageApiSecret,
      to: phoneNumber,
      from: config.vonageFrom,
      text: `Your verification code is ${code}`,
    })
    const response = await fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) throw new Error('Vonage SMS delivery failed.')
    const payload = (await response.json()) as { messages?: Array<{ status?: string }> }
    if (payload.messages?.[0]?.status !== '0') throw new Error('Vonage SMS delivery failed.')
    return
  }

  if (config.smsProvider === 'messagebird') {
    if (!config.messageBirdAccessKey || !config.messageBirdOriginator) {
      throw new Error('MessageBird SMS provider is not configured.')
    }
    const body = new URLSearchParams({
      originator: config.messageBirdOriginator,
      recipients: phoneNumber,
      body: `Your verification code is ${code}`,
    })
    const response = await fetch('https://rest.messagebird.com/messages', {
      method: 'POST',
      headers: {
        Authorization: `AccessKey ${config.messageBirdAccessKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!response.ok) throw new Error('MessageBird SMS delivery failed.')
    return
  }

  throw new Error(`Unsupported SMS provider: ${config.smsProvider}`)
}

export async function buildOAuthAccessTokenClaims(
  deps: Deps,
  input: {
    user?: ({ id?: string } & Record<string, unknown>) | null
    scopes: Iterable<string>
    resource?: string
    referenceId?: string
    metadata?: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  const scopes = [...input.scopes]
  const identityScopes = new Set<string>(userConfigurableApplicationScopes)
  const applicationId = readString(input.metadata, 'applicationId')
  const application = applicationId ? await deps.applications.findById(applicationId) : null
  const tenantOrganizationId = await resolveOAuthOrganizationId(deps, input, application)
  const {
    authorization: _authorization,
    groups,
    ...claims
  } = await buildTokenClaims(deps, {
    userId: input.user?.id,
    applicationId,
    organizationId: tenantOrganizationId ?? (!input.user ? application?.ownerOrganizationId : undefined),
    resource: input.resource,
    scopes,
    authorizedScopes: scopes.filter((scope) => !identityScopes.has(scope)),
  } satisfies AuthorizationTokenClaimInput)
  const organizationId = tenantOrganizationId ?? (!input.user && application ? application.ownerOrganizationId : null)
  return {
    ...claims,
    ...(tenantOrganizationId && input.user?.id ? { groups } : {}),
    ...(organizationId ? { [realmrootOrganizationClaim]: organizationId } : {}),
  }
}

export async function buildOAuthIdTokenClaims(
  deps: Deps,
  input: {
    user: { id?: string } & Record<string, unknown>
    scopes: Iterable<string>
    referenceId?: string
    metadata?: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  const applicationId = readString(input.metadata, 'applicationId')
  const application = applicationId ? await deps.applications.findById(applicationId) : null
  if (!application || !input.user.id) return {}
  await requireApplicationUserAccess(deps, application, input.user.id, 'access_denied')
  const organizationId = await resolveOAuthOrganizationId(deps, input, application)
  if (!organizationId) return {}
  const scopes = new Set(input.scopes)
  const groups = scopes.has('groups')
    ? await deps.authorization.listTeamNamesForUser(organizationId, input.user.id)
    : undefined
  return {
    [realmrootOrganizationClaim]: organizationId,
    ...(groups ? { groups } : {}),
  }
}

export async function filterOAuthAccessTokenScopes(
  deps: Deps,
  input: {
    user?: ({ id?: string } & Record<string, unknown>) | null
    scopes: Iterable<string>
    resource?: string
    referenceId?: string
    metadata?: Record<string, unknown>
    grantType?: string
  },
) {
  const requestedScopes = [...input.scopes]
  const applicationId = readString(input.metadata, 'applicationId')
  const application = applicationId ? await deps.applications.findById(applicationId) : null
  if (!application || application.disabled) return []
  if (input.user?.id) {
    await requireApplicationUserAccess(
      deps,
      application,
      input.user.id,
      input.grantType === 'refresh_token' ? 'invalid_grant' : 'access_denied',
    )
  }
  const oidcScopeSet = new Set<string>(userConfigurableApplicationScopes)
  const requestedOidcScopes = requestedScopes.filter((scope) => oidcScopeSet.has(scope))
  if (requestedOidcScopes.some((scope) => !application.oidcScopes.includes(scope as never))) {
    throw oauthProviderError('invalid_scope', 'Requested OIDC scope is not allowed for this client.')
  }

  if (!input.resource) {
    if (requestedScopes.some((scope) => !oidcScopeSet.has(scope))) {
      throw oauthProviderError('invalid_scope', 'Resource scopes require one registered Resource Server target.')
    }
    if (!input.user?.id) return []
    if (!application.consentRequired) {
      await deps.applications.recordPolicyAuthorization({
        applicationId: application.id,
        userId: input.user.id,
        resourceServerId: null,
        scopes: requestedOidcScopes,
      })
    }
    return requestedOidcScopes
  }

  const resource = await deps.authorization.findResourceByResourceUrl(input.resource)
  if (!resource?.enabled || !resource.scopeRegistry) {
    throw oauthProviderError('invalid_target', 'Requested Resource Server is not active.')
  }
  const tenantOrganizationId = await resolveOAuthOrganizationId(
    deps,
    input,
    application,
    input.grantType === 'refresh_token' ? 'invalid_grant' : 'access_denied',
  )
  const visible = input.user?.id
    ? resource.visibility === 'public' || tenantOrganizationId === resource.ownerOrganizationId
    : resourceVisibleToOrganization(resource, application.ownerOrganizationId)
  if (!visible)
    throw oauthProviderError('invalid_target', 'Requested Resource Server is not visible to this principal.')
  const configuration = application.resourceScopes.find((item) => item.resourceServerId === resource.id)
  const requestedResourceScopes = requestedScopes.filter((scope) => !oidcScopeSet.has(scope))
  const declaredScopes = new Set(resource.scopeRegistry.scopes.map((scope) => scope.value))
  const targetResourceScopes = requestedResourceScopes.filter(
    (scope) => configuration?.scopes.includes(scope) && declaredScopes.has(scope),
  )
  if (
    input.grantType !== 'authorization_code' &&
    input.grantType !== 'refresh_token' &&
    targetResourceScopes.length !== requestedResourceScopes.length
  ) {
    throw oauthProviderError('invalid_scope', 'Requested Resource Server scope is not allowed for this client.')
  }

  if (!input.user?.id) {
    const effective = new Set(await applicationEffectiveResourceScopes(deps, application, resource))
    return targetResourceScopes.filter((scope) => effective.has(scope))
  }

  const effective = new Set(
    await userEffectiveResourceScopes(deps, input.user.id, resource, new Date(), tenantOrganizationId),
  )
  const consent = !application.consentRequired
    ? null
    : await deps.applications.findConsent(application.id, input.user.id, resource.id)
  const consented = !application.consentRequired ? new Set(targetResourceScopes) : new Set(consent?.scopes ?? [])
  const authorizedScopes = [
    ...requestedOidcScopes,
    ...targetResourceScopes.filter((scope) => effective.has(scope) && consented.has(scope)),
  ]
  if (!application.consentRequired) {
    await deps.applications.recordPolicyAuthorization({
      applicationId: application.id,
      userId: input.user.id,
      resourceServerId: resource.id,
      scopes: authorizedScopes,
    })
  }
  return authorizedScopes
}

async function resolveOAuthOrganizationId(
  deps: Deps,
  input: { user?: ({ id?: string } & Record<string, unknown>) | null; resource?: string; referenceId?: string },
  application: Awaited<ReturnType<Deps['applications']['findById']>>,
  oauthError: 'access_denied' | 'invalid_grant' = 'access_denied',
) {
  const userId = input.user?.id
  if (!userId) return null
  if (input.referenceId?.startsWith('user:')) {
    if (input.referenceId !== `user:${userId}` || application?.visibility === 'private') {
      throw oauthProviderError(oauthError, 'The selected authorization Context is invalid.')
    }
    return null
  }
  const selectedOrganizationId = input.referenceId?.startsWith('organization:')
    ? input.referenceId.slice('organization:'.length)
    : input.referenceId
  if (selectedOrganizationId) {
    if (application?.visibility === 'private' && selectedOrganizationId !== application.ownerOrganizationId) {
      throw oauthProviderError(oauthError, 'The selected authorization Context is unavailable.')
    }
    const [organization, membership] = await Promise.all([
      deps.authorization.findOrganization(selectedOrganizationId),
      deps.authorization.findMemberByOrganizationUser(selectedOrganizationId, userId),
    ])
    if (!organization || organization.disabled || !membership) {
      throw oauthProviderError(oauthError, 'The selected authorization Context is no longer available.')
    }
    return selectedOrganizationId
  }
  if (application?.visibility === 'private') {
    const [organization, membership] = await Promise.all([
      deps.authorization.findOrganization(application.ownerOrganizationId),
      deps.authorization.findMemberByOrganizationUser(application.ownerOrganizationId, userId),
    ])
    if (!organization || organization.disabled || !membership) {
      throw oauthProviderError(oauthError, 'The Application authorization Context is no longer available.')
    }
    return application.ownerOrganizationId
  }
  if (!input.resource) return null
  const resource = await deps.authorization.findResourceByResourceUrl(input.resource)
  if (resource?.visibility !== 'private') return null
  const [organization, membership] = await Promise.all([
    deps.authorization.findOrganization(resource.ownerOrganizationId),
    deps.authorization.findMemberByOrganizationUser(resource.ownerOrganizationId, userId),
  ])
  if (!organization || organization.disabled || !membership) {
    throw oauthProviderError(oauthError, 'The Resource Server authorization Context is no longer available.')
  }
  return resource.ownerOrganizationId
}

export async function requireApplicationUserAccess(
  deps: Deps,
  application: NonNullable<Awaited<ReturnType<Deps['applications']['findById']>>>,
  userId: string,
  oauthError: 'access_denied' | 'invalid_grant' = 'access_denied',
) {
  if (!(await applicationUserHasAccess(deps, application, userId))) {
    throw oauthProviderError(oauthError, 'The Application is unavailable to this user.')
  }
}

export async function applicationUserHasAccess(
  deps: Deps,
  application: NonNullable<Awaited<ReturnType<Deps['applications']['findById']>>>,
  userId: string,
) {
  const organization = await deps.authorization.findOrganization(application.ownerOrganizationId)
  if (!organization || organization.disabled) return false
  if (application.visibility === 'public') return true
  return Boolean(await deps.authorization.findMemberByOrganizationUser(application.ownerOrganizationId, userId))
}

function oauthProviderError(error: string, description: string) {
  return new APIError('BAD_REQUEST', { error, error_description: description })
}

export function readString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

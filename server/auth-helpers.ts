import type { TransactionalEmailSender } from '@server/adapters/gateways/email/sender'
import { type AuthorizationTokenClaimInput, buildTokenClaims } from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import {
  applicationEffectiveResourceScopes,
  userEffectiveResourceScopes,
} from '@server/usecases/resource-scope-entitlements'
import { resourceVisibleToOrganization } from '@server/usecases/resource-visibility'
import { userConfigurableApplicationScopes } from '@shared/api/applications'
import { APIError } from 'better-auth'
import { type ApplicationOidcClaims, defaultApplicationOidcClaims } from '../shared/api/applications'
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

export async function buildOAuthUserInfoClaims(
  deps: Deps,
  applications: {
    findByClientId(clientId: string): Promise<{ id: string; oidcClaims: ApplicationOidcClaims } | null>
  },
  input: {
    clientId?: string
    user: unknown
    scopes: Iterable<string>
    jwt: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  if (!input.clientId) return {}
  const application = await applications.findByClientId(input.clientId)
  if (!application) return {}
  return buildTokenClaims(deps, {
    userId: readUserId(input.user),
    applicationId: application.id,
    organizationId:
      readAuthorizationString(input.jwt, 'organization_id') ?? readJwtString(input.jwt, 'organization_id'),
    resource: readString(input.jwt, 'aud'),
    scopes: [...input.scopes],
    destination: 'userinfo',
    claimSelection: application.oidcClaims.userInfo,
  })
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
  const oidcClaims = readOidcClaims(input.metadata)
  const scopes = [...input.scopes]
  const identityScopes = new Set<string>(userConfigurableApplicationScopes)
  const applicationId = readString(input.metadata, 'applicationId')
  const application = !input.user && applicationId ? await deps.applications.findById(applicationId) : null
  const claims = await buildTokenClaims(deps, {
    userId: input.user?.id,
    applicationId,
    organizationId: input.referenceId ?? application?.ownerOrganizationId,
    resource: input.resource,
    scopes,
    authorizedScopes: scopes.filter((scope) => !identityScopes.has(scope)),
    destination: 'access_token',
    claimSelection: oidcClaims.accessToken,
  } satisfies AuthorizationTokenClaimInput)
  return claims
}

export async function filterOAuthAccessTokenScopes(
  deps: Deps,
  input: {
    user?: ({ id?: string } & Record<string, unknown>) | null
    scopes: Iterable<string>
    resource?: string
    referenceId?: string
    metadata?: Record<string, unknown>
  },
) {
  const requestedScopes = [...input.scopes]
  const applicationId = readString(input.metadata, 'applicationId')
  const application = applicationId ? await deps.applications.findById(applicationId) : null
  if (!application || application.disabled) return []
  const oidcScopeSet = new Set<string>(userConfigurableApplicationScopes)
  const requestedOidcScopes = requestedScopes.filter((scope) => oidcScopeSet.has(scope))
  if (requestedOidcScopes.some((scope) => !application.oidcScopes.includes(scope as never))) {
    throw oauthProviderError('invalid_scope', 'Requested OIDC scope is not allowed for this client.')
  }

  if (!input.resource) {
    if (requestedScopes.some((scope) => !oidcScopeSet.has(scope))) {
      throw oauthProviderError('invalid_scope', 'Resource scopes require one registered Resource Server target.')
    }
    return input.user ? requestedOidcScopes : []
  }

  const resource = await deps.authorization.findResourceByResourceUrl(input.resource)
  if (!resource?.enabled || resource.archivedAt || !resource.scopeRegistry) {
    throw oauthProviderError('invalid_target', 'Requested Resource Server is not active.')
  }
  const visible = input.user?.id
    ? resource.visibility === 'public' ||
      (await deps.authorization.listUserMemberships(input.user.id)).some(
        (membership) => membership.organizationId === resource.ownerOrganizationId,
      )
    : resourceVisibleToOrganization(resource, application.ownerOrganizationId)
  if (!visible)
    throw oauthProviderError('invalid_target', 'Requested Resource Server is not visible to this principal.')
  const configuration = application.resourceScopes.find((item) => item.resourceServerId === resource.id)
  const requestedResourceScopes = requestedScopes.filter((scope) => !oidcScopeSet.has(scope))
  const declaredScopes = new Set(resource.scopeRegistry.scopes.map((scope) => scope.value))
  if (requestedResourceScopes.some((scope) => !configuration?.scopes.includes(scope) || !declaredScopes.has(scope))) {
    throw oauthProviderError('invalid_scope', 'Requested Resource Server scope is not allowed for this client.')
  }

  if (!input.user?.id) {
    const effective = new Set(await applicationEffectiveResourceScopes(deps, application, resource))
    return requestedResourceScopes.filter((scope) => effective.has(scope))
  }

  const effective = new Set(await userEffectiveResourceScopes(deps, input.user.id, resource))
  const consent = application.trusted
    ? null
    : await deps.applications.findConsent(application.id, input.user.id, resource.id)
  const consented = application.trusted ? new Set(requestedResourceScopes) : new Set(consent?.scopes ?? [])
  return [
    ...requestedOidcScopes,
    ...requestedResourceScopes.filter((scope) => effective.has(scope) && consented.has(scope)),
  ]
}

function oauthProviderError(error: string, description: string) {
  return new APIError('BAD_REQUEST', { error, error_description: description })
}

export async function buildOAuthIdTokenClaims(
  deps: Deps,
  input: {
    user?: ({ id?: string } & Record<string, unknown>) | null
    scopes?: Iterable<string>
    metadata?: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  const applicationId = readString(input.metadata, 'applicationId')
  const oidcClaims = readOidcClaims(input.metadata)
  return {
    ...(applicationId ? { application_id: applicationId } : {}),
    ...(await buildTokenClaims(deps, {
      userId: input.user?.id,
      applicationId,
      scopes: input.scopes ? [...input.scopes] : [],
      destination: 'id_token',
      claimSelection: oidcClaims.idToken,
    })),
  }
}

export function readOidcClaims(metadata: Record<string, unknown> | undefined): ApplicationOidcClaims {
  const value = metadata?.oidcClaims
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultApplicationOidcClaims
  return {
    accessToken: readClaimSelection((value as Record<string, unknown>).accessToken),
    idToken: readClaimSelection((value as Record<string, unknown>).idToken),
    userInfo: readClaimSelection((value as Record<string, unknown>).userInfo),
  }
}

export function readClaimSelection(value: unknown): ApplicationOidcClaims['accessToken'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    ...(input.authorization === true ? { authorization: true } : {}),
    ...(input.scopes === true ? { scopes: true } : {}),
    ...(input.groups === true ? { groups: true } : {}),
    ...(input.roles === true ? { roles: true } : {}),
    ...(input.organizationId === true ? { organizationId: true } : {}),
    ...(input.organizationName === true ? { organizationName: true } : {}),
  }
}

export function readAuthorizationString(jwt: Record<string, unknown>, key: string) {
  const authorization = jwt.authorization
  if (typeof authorization !== 'object' || authorization === null || !(key in authorization)) return undefined
  const value = (authorization as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export function readJwtString(jwt: Record<string, unknown>, key: string) {
  const value = jwt[key]
  return typeof value === 'string' ? value : undefined
}

export function readString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

export function readUserId(user: unknown) {
  return typeof user === 'object' && user !== null && 'id' in user && typeof user.id === 'string' ? user.id : undefined
}

export function readUserRole(user: unknown) {
  return typeof user === 'object' && user !== null && 'role' in user && typeof user.role === 'string' ? user.role : null
}

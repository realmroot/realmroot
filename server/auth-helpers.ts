import type { TransactionalEmailSender } from '@server/adapters/gateways/email/sender'
import { type AuthorizationTokenClaimInput, buildTokenClaims } from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import {
  type ApplicationOidcClaims,
  defaultApplicationOidcClaims,
  managementApplicationScopes,
} from '../shared/api/applications'
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
        body: 'Your FlareAuth password was changed. If this was not you, reset your password immediately.',
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
  const claims = await buildTokenClaims(deps, {
    userId: input.user?.id,
    applicationId: readString(input.metadata, 'applicationId'),
    organizationId: input.referenceId,
    resource: input.resource,
    scopes: [...input.scopes],
    destination: 'access_token',
    claimSelection: oidcClaims.accessToken,
  } satisfies AuthorizationTokenClaimInput)
  return claims
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
    ...(input.roles === true ? { roles: true } : {}),
    ...(input.permissions === true ? { permissions: true } : {}),
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

export function hasManagementScope(scopes: Iterable<string>) {
  for (const scope of scopes) {
    if (managementApplicationScopes.includes(scope as (typeof managementApplicationScopes)[number])) return true
  }
  return false
}

export function readUserRole(user: unknown) {
  return typeof user === 'object' && user !== null && 'role' in user && typeof user.role === 'string' ? user.role : null
}

/// <reference types="@cloudflare/workers-types" />
/// <reference path="./worker-configuration.d.ts" />

import type { SecurityPolicy } from '@shared/api/security'

export interface EmailAddress {
  email: string
  name: string
}

export interface EmailMessageBuilder {
  to: string | string[]
  from: string | EmailAddress
  subject: string
  html?: string
  text?: string
  replyTo?: string | EmailAddress
  headers?: Record<string, string>
}

export interface EmailSendResult {
  messageId: string
}

export interface SendEmail {
  send(message: EmailMessageBuilder): Promise<EmailSendResult>
}

/**
 * Bindings + declared vars (DB, ASSET_BUCKET, EMAIL_QUEUE, ASSETS, EMAIL_FROM,
 * EMAIL_FROM_NAME, BETTER_AUTH_SECRET) are typed from wrangler.toml via the generated
 * `Cloudflare.Env` (regenerate with `pnpm cf-typegen`). EMAIL is narrowed to our
 * transactional `SendEmail` wrapper, and the optional runtime config vars below are
 * declared by hand because they are deployment secrets/vars, not wrangler bindings.
 */
export type Env = Omit<Cloudflare.Env, 'EMAIL'> & {
  EMAIL: SendEmail
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
  MFA_POLICY?: string
  PASSKEY_ENABLED?: string
  SESSION_DURATION_SECONDS?: string
  SESSION_UPDATE_AGE_SECONDS?: string
  SESSION_FRESH_AGE_SECONDS?: string
  SESSION_COOKIE_CACHE_SECONDS?: string
  WEBAUTHN_RP_ID?: string
  WEBAUTHN_RP_NAME?: string
  WEBAUTHN_ORIGINS?: string
}

export interface RuntimeConfig {
  authSecret: string
  baseURL: string
  emailFrom: string
  emailFromName?: string
  trustedOrigins: string[]
  securityPolicy: SecurityPolicy
}

export function validateEnv(env: Env, requestUrl: string): RuntimeConfig {
  const origin = new URL(requestUrl).origin
  const baseURL = parseOrigin(env.BETTER_AUTH_URL || origin, 'BETTER_AUTH_URL')
  const trustedOrigins = parseTrustedOrigins(env.TRUSTED_ORIGINS, baseURL)
  const securityPolicy = parseSecurityPolicy(env, baseURL, trustedOrigins)

  if (!env.DB) {
    throw new Error('DB binding is not configured for this deployment.')
  }

  if (!env.ASSETS) {
    throw new Error('ASSETS binding is not configured for this deployment.')
  }

  if (!env.EMAIL) {
    throw new Error('EMAIL binding is not configured for this deployment.')
  }

  if (!env.ASSET_BUCKET) {
    throw new Error('ASSET_BUCKET binding is not configured for this deployment.')
  }

  if (!env.EMAIL_QUEUE) {
    throw new Error('EMAIL_QUEUE binding is not configured for this deployment.')
  }

  if (!env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is not configured for this deployment.')
  }

  if (!env.EMAIL_FROM) {
    throw new Error('EMAIL_FROM is not configured for this deployment.')
  }

  return {
    authSecret: env.BETTER_AUTH_SECRET,
    baseURL,
    emailFrom: env.EMAIL_FROM,
    emailFromName: env.EMAIL_FROM_NAME,
    trustedOrigins,
    securityPolicy,
  }
}

function parseSecurityPolicy(env: Env, baseURL: string, trustedOrigins: string[]): SecurityPolicy {
  const rpId = env.WEBAUTHN_RP_ID ?? new URL(baseURL).hostname

  if (!rpId || rpId.includes('/') || rpId.includes(':')) {
    throw new Error(`WEBAUTHN_RP_ID must be a domain name or localhost: ${rpId}`)
  }

  return {
    mfa: {
      mode: parseMfaPolicy(env.MFA_POLICY),
      authenticatorAppEnabled: true,
      emailOtpEnabled: false,
      backupCodesEnabled: true,
    },
    passkeys: {
      enabled: parseBoolean(env.PASSKEY_ENABLED, true, 'PASSKEY_ENABLED'),
      rpId,
      rpName: env.WEBAUTHN_RP_NAME || 'FlareAuth',
      origins: env.WEBAUTHN_ORIGINS ? parseTrustedOrigins(env.WEBAUTHN_ORIGINS, baseURL) : trustedOrigins,
    },
    sessions: {
      expiresInSeconds: parsePositiveInteger(
        env.SESSION_DURATION_SECONDS,
        60 * 60 * 24 * 7,
        'SESSION_DURATION_SECONDS',
      ),
      updateAgeSeconds: parseNonNegativeInteger(
        env.SESSION_UPDATE_AGE_SECONDS,
        60 * 60 * 24,
        'SESSION_UPDATE_AGE_SECONDS',
      ),
      freshAgeSeconds: parseNonNegativeInteger(
        env.SESSION_FRESH_AGE_SECONDS,
        60 * 60 * 24,
        'SESSION_FRESH_AGE_SECONDS',
      ),
      cookieCacheSeconds: parsePositiveInteger(
        env.SESSION_COOKIE_CACHE_SECONDS,
        60 * 5,
        'SESSION_COOKIE_CACHE_SECONDS',
      ),
    },
    password: {
      minLength: 8,
      requiredCharacterTypes: 1,
      customWords: [],
      rejectUserInfo: true,
      rejectSequential: true,
      rejectCustomWords: false,
    },
    captcha: {
      enabled: false,
      provider: 'turnstile',
      siteKey: '',
      secretBinding: '',
    },
    blocklist: {
      blockSubaddressing: false,
      entries: [],
    },
  }
}

function parseMfaPolicy(value: string | undefined): SecurityPolicy['mfa']['mode'] {
  if (value === undefined || value === 'optional' || value === 'required') {
    return value ?? 'optional'
  }

  throw new Error('MFA_POLICY must be one of: optional, required')
}

function parseBoolean(value: string | undefined, defaultValue: boolean, label: string): boolean {
  if (value === undefined) {
    return defaultValue
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(`${label} must be true or false`)
}

function parsePositiveInteger(value: string | undefined, defaultValue: number, label: string): number {
  const parsed = parseNonNegativeInteger(value, defaultValue, label)

  if (parsed === 0) {
    throw new Error(`${label} must be greater than 0`)
  }

  return parsed
}

function parseNonNegativeInteger(value: string | undefined, defaultValue: number, label: string): number {
  if (value === undefined) {
    return defaultValue
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }

  return parsed
}

function parseTrustedOrigins(value: string | undefined, baseURL: string): string[] {
  const origins = (
    value
      ? value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      : [baseURL]
  ).map((origin) => parseOrigin(origin))

  return [...new Set(origins)]
}

function parseOrigin(value: string, label = 'TRUSTED_ORIGINS entry'): string {
  const url = new URL(value)

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an origin: ${value}`)
  }

  return url.origin
}

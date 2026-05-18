/// <reference types="@cloudflare/workers-types" />

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

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  EMAIL: SendEmail
  BETTER_AUTH_SECRET: string
  EMAIL_FROM: string
  EMAIL_FROM_NAME?: string
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
}

export interface RuntimeConfig {
  authSecret: string
  baseURL: string
  emailFrom: string
  emailFromName?: string
  trustedOrigins: string[]
}

export function validateEnv(env: Env, requestUrl: string): RuntimeConfig {
  const origin = new URL(requestUrl).origin
  const baseURL = parseOrigin(env.BETTER_AUTH_URL || origin, 'BETTER_AUTH_URL')
  const trustedOrigins = parseTrustedOrigins(env.TRUSTED_ORIGINS, baseURL)

  if (!env.DB) {
    throw new Error('DB binding is not configured for this deployment.')
  }

  if (!env.EMAIL) {
    throw new Error('EMAIL binding is not configured for this deployment.')
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
  }
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

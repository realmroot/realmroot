import { badRequest, forbidden } from '@server/domain/errors'
import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import type { SecurityRepository } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import type { MiddlewareHandler } from 'hono'
import { getAuthContext } from './auth-context'

const mfaEnrollmentPaths = new Set([
  '/api/account/security',
  '/api/account/security/mfa',
  '/api/account/security/mfa/totp-enrollment',
  '/api/account/security/mfa/totp-verification',
  '/api/account/security/mfa/backup-codes',
])

export function requireSecurityPolicy(security: SecurityRepository): MiddlewareHandler {
  return async (c, next) => {
    const policy = await security.getPolicy()

    if (policy.mfa.mode === 'required') {
      const { user } = getAuthContext(c)
      if (user && !isMfaExemptPath(c.req.path)) {
        const state = await security.getSecurityState(user.id)
        if (!state.mfa.enabled) {
          throw forbidden('MFA enrollment is required for this deployment.')
        }
      }
    }

    if (c.req.path.startsWith('/api/auth/')) {
      await enforceHostedAuthPolicy(c.req.raw, policy, (c.env ?? {}) as Record<string, unknown>)
    }

    await next()
  }
}

function isMfaExemptPath(path: string): boolean {
  return (
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/assets/') ||
    path === '/api/health' ||
    mfaEnrollmentPaths.has(path)
  )
}

async function enforceHostedAuthPolicy(request: Request, policy: SecurityPolicy, env: Record<string, unknown>) {
  const path = new URL(request.url).pathname
  const body = await readJsonBody(request)

  if (path === '/api/auth/sign-up/email') {
    validateEmailPolicy(readString(body, 'email'), policy.blocklist)
    validatePasswordPolicy(readString(body, 'password'), policy.password, {
      email: readString(body, 'email'),
      name: readOptionalString(body, 'name'),
      username: readOptionalString(body, 'username'),
    })
  }

  if (path === '/api/auth/reset-password') {
    validatePasswordPolicy(readString(body, 'newPassword'), policy.password)
  }

  if (path === '/api/auth/email-otp/reset-password') {
    validatePasswordPolicy(readString(body, 'password'), policy.password, { email: readOptionalString(body, 'email') })
  }

  if (path === '/api/auth/change-password') {
    validatePasswordPolicy(readString(body, 'newPassword'), policy.password)
  }

  if (requiresCaptcha(path)) {
    await verifyCaptcha(readOptionalString(body, 'captchaToken'), policy.captcha, env)
  }
}

function requiresCaptcha(path: string) {
  return new Set([
    '/api/auth/sign-in/email',
    '/api/auth/sign-in/username',
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/sign-up/email',
    '/api/auth/request-password-reset',
    '/api/auth/email-otp/request-password-reset',
  ]).has(path)
}

async function verifyCaptcha(token: string | null, captcha: SecurityPolicy['captcha'], env: Record<string, unknown>) {
  if (!captcha.enabled) return
  if (!token) throw badRequest('CAPTCHA verification is required.')

  const secret = env[captcha.secretBinding]
  if (typeof secret !== 'string' || !secret) {
    throw badRequest('CAPTCHA secret binding is not configured.')
  }

  const body = new FormData()
  body.set('secret', secret)
  body.set('response', token)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  })
  const result = (await response.json()) as { success?: boolean }
  if (!response.ok || result.success !== true) {
    throw badRequest('CAPTCHA verification failed.')
  }
}

async function readJsonBody(request: Request) {
  if (request.method !== 'POST') return {}
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return {}
  try {
    const body = (await request.clone().json()) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid JSON body.')
    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid JSON body.') throw error
    throw badRequest('Invalid JSON body.')
  }
}

function readString(body: Record<string, unknown>, key: string) {
  const value = body[key]
  if (typeof value !== 'string') throw badRequest(`${key} is required.`)
  return value
}

function readOptionalString(body: Record<string, unknown>, key: string) {
  const value = body[key]
  return typeof value === 'string' ? value : null
}

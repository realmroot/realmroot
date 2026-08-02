import { badGateway, badRequest, forbidden } from '@server/domain/errors'
import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import type { SecurityRepository } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import type { MiddlewareHandler } from 'hono'
import { getPrincipal } from './authn'

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
      const { user } = getPrincipal(c)
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
    path === '/api/configz' ||
    path === '/api/account/profile' ||
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
    await verifyCaptcha(readOptionalString(body, 'captchaToken'), policy.captcha, request, env)
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

async function verifyCaptcha(
  token: string | null,
  captcha: SecurityPolicy['captcha'],
  request: Request,
  env: Record<string, unknown>,
) {
  if (!captcha.enabled) return
  if (!token) throw badRequest('CAPTCHA verification is required.')
  const secretKey =
    captcha.secretKey ||
    (captcha.legacySecretBinding && typeof env[captcha.legacySecretBinding] === 'string'
      ? (env[captcha.legacySecretBinding] as string)
      : '')
  if (!secretKey) throw badRequest('CAPTCHA secret key is not configured.')

  const remoteIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')
  const verified =
    captcha.provider === 'recaptcha-enterprise'
      ? await verifyRecaptchaEnterprise(token, captcha, secretKey, request, remoteIp)
      : await verifySiteCaptcha(token, captcha, secretKey, remoteIp)
  if (!verified) throw badRequest('CAPTCHA verification failed.')
}

async function verifySiteCaptcha(
  token: string,
  captcha: SecurityPolicy['captcha'],
  secretKey: string,
  remoteIp: string | null,
): Promise<boolean> {
  const body = new URLSearchParams({ secret: secretKey, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)
  if (captcha.provider === 'hcaptcha') body.set('sitekey', captcha.siteKey)
  const url =
    captcha.provider === 'hcaptcha'
      ? 'https://api.hcaptcha.com/siteverify'
      : 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
  const response = await fetchCaptcha(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const result = (await response.json()) as { success?: boolean }
  return result.success === true
}

async function verifyRecaptchaEnterprise(
  token: string,
  captcha: SecurityPolicy['captcha'],
  secretKey: string,
  request: Request,
  remoteIp: string | null,
): Promise<boolean> {
  if (!captcha.projectId) throw badRequest('reCAPTCHA Enterprise project ID is not configured.')
  const response = await fetchCaptcha(
    `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(captcha.projectId)}/assessments?key=${encodeURIComponent(secretKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          token,
          siteKey: captcha.siteKey,
          ...(remoteIp ? { userIpAddress: remoteIp } : {}),
          ...(request.headers.get('User-Agent') ? { userAgent: request.headers.get('User-Agent') } : {}),
        },
      }),
    },
  )
  const result = (await response.json()) as { tokenProperties?: { valid?: boolean } }
  return result.tokenProperties?.valid === true
}

async function fetchCaptcha(url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw badGateway('CAPTCHA provider is unavailable.')
  }
  if (!response.ok) throw badGateway('CAPTCHA provider rejected the verification request.')
  return response
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

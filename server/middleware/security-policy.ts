import type { MiddlewareHandler } from 'hono'
import type { SecurityPolicy } from '../../shared/api/security'
import { forbidden } from '../lib/errors'
import type { SecurityRepository } from '../modules/security/repository'
import { getAuthContext } from './auth-context'

const mfaEnrollmentPaths = new Set([
  '/api/account/security',
  '/api/account/security/mfa',
  '/api/account/security/mfa/totp-enrollment',
  '/api/account/security/mfa/totp-verification',
  '/api/account/security/mfa/otp',
  '/api/account/security/mfa/otp-verification',
  '/api/account/security/mfa/backup-codes',
])

export function requireDeploymentMfa(policy: SecurityPolicy, security: SecurityRepository): MiddlewareHandler {
  return async (c, next) => {
    if (policy.mfa.mode !== 'required') {
      await next()
      return
    }

    const { user } = getAuthContext(c)

    if (!user || isMfaExemptPath(c.req.path)) {
      await next()
      return
    }

    const state = await security.getSecurityState(user.id)

    if (!state.mfa.enabled) {
      throw forbidden('MFA enrollment is required for this deployment.')
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

/**
 * Per-request configz options. The issuer is derived from the request URL; the
 * security policy is captured from the app config at assembly time.
 */
import type { ConfigzOptions } from '@server/usecases/configz'
import type { SecurityPolicy } from '@shared/api/security'
import type { Context } from 'hono'

export function configzOptions(c: Context, securityPolicy?: SecurityPolicy): ConfigzOptions {
  const url = new URL(c.req.url)
  return {
    issuer: `${url.protocol}//${url.host}`,
    emailOtpEnabled: true,
    usernameEnabled: true,
    securityPolicy,
  }
}

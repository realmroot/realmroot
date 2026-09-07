import { createMiddleware } from 'hono/factory'
import { isBrowserNavigation } from '../browser-navigation'

export function hostedAuthErrors() {
  return createMiddleware(async (c, next) => {
    await next()
    const path = c.req.path
    const interactivePath =
      path === '/api/auth/oauth2/authorize' ||
      path === '/api/auth/oauth2/end-session' ||
      path === '/api/auth/error' ||
      path === '/api/auth/verify-email' ||
      path.startsWith('/api/auth/reset-password/') ||
      path.startsWith('/api/auth/callback/') ||
      path.startsWith('/api/auth/oauth2/callback/') ||
      path === '/oauth/account-connection/callback'
    if (!interactivePath || !isBrowserNavigation(c.req.raw) || c.res.status < 400) return

    let code = 'server_error'
    let message = 'Unable to complete this request. Please try again.'
    if (c.res.status < 500 && c.res.headers.get('Content-Type')?.includes('application/json')) {
      const body = (await c.res.clone().json()) as {
        error?: string | { code?: string; message?: string }
        error_description?: string
        message?: string
        code?: string
      }
      code = typeof body.error === 'string' ? body.error : (body.error?.code ?? body.code ?? 'invalid_request')
      message =
        body.error_description ??
        (typeof body.error === 'object' ? body.error.message : undefined) ??
        body.message ??
        message
    }
    const query = new URLSearchParams({ error: code, error_description: message })
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.res = c.redirect(`/auth/error?${query}`, 303)
  })
}

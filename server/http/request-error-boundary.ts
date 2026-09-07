import { isBrowserNavigation } from './browser-navigation'

// Runs outside application/configuration setup. Browser recovery must not require DB, assets, or JavaScript.
export async function withRequestErrorBoundary(request: Request, handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle()
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error('Request failed outside the HTTP error boundary.', { requestId, error })
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Request-Id': requestId }
    const path = new URL(request.url).pathname
    const oauth = path.startsWith('/api/auth/oauth2/')
    if (
      isBrowserNavigation(request) &&
      !['/api/auth/oauth2/token', '/api/auth/oauth2/introspect', '/api/auth/oauth2/revoke'].includes(path)
    ) {
      const zh = request.headers.get('Accept-Language')?.startsWith('zh') ?? false
      const title = zh ? '暂时无法完成操作' : 'Unable to complete this request'
      const message = zh
        ? '服务暂时不可用。如果你已经提交授权决定，请先在发起操作的应用中确认结果。你可以稍后返回应用重试，或联系管理员并提供以下请求编号。'
        : 'The service is temporarily unavailable. If you submitted an authorization decision, check its status in the requesting application. Try again later or contact an administrator with the request ID below.'
      return new Response(
        `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Realmroot</title><style>body{margin:0;background:#f5f8f8;color:#142022;font:16px/1.6 system-ui,sans-serif}main{box-sizing:border-box;max-width:500px;margin:10vh auto;padding:28px;background:white;border:1px solid #d8e2e3;border-radius:16px;overflow-wrap:anywhere}h1{font-size:24px}a{display:inline-block;padding:12px;color:#005f66}a:focus-visible{outline:3px solid #007b83}@media(max-width:540px){main{margin:32px 16px}}</style></head><body><main><strong>Realmroot</strong><h1>${title}</h1><p role="alert">${message}</p><p>${zh ? '请求编号' : 'Request ID'}: <code>${requestId}</code></p><a href="/auth/sign-in">${zh ? '返回登录' : 'Back to sign in'}</a></main></body></html>`,
        {
          status: 500,
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
        },
      )
    }
    return Response.json(
      oauth
        ? { error: 'server_error', error_description: 'The service is temporarily unavailable.' }
        : { error: { code: 'internal_error', message: 'The service is temporarily unavailable.', requestId } },
      { status: 500, headers },
    )
  }
}

import type { MiddlewareHandler } from 'hono'

export const accessLog = (): MiddlewareHandler => async (c, next) => {
  let caught: unknown

  try {
    await next()
  } catch (error) {
    caught = error
    throw error
  } finally {
    const context = c.get('requestContext')
    const status = caught ? 500 : c.res.status
    const error = c.error ?? (caught instanceof Error ? caught : null)

    const entry = JSON.stringify({
      event: 'request.complete',
      requestId: context.id,
      correlationId: context.correlationId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status,
      durationMs: Date.now() - context.startedAt,
      ...(error
        ? {
            errorName: error.name,
            errorMessage: error.message,
            ...(status >= 500 ? { errorStack: error.stack } : {}),
          }
        : {}),
    })

    if (status >= 500) console.error(entry)
    else console.info(entry)
  }
}

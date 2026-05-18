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

    console.info(
      JSON.stringify({
        requestId: context.id,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status,
        durationMs: Date.now() - context.startedAt,
      }),
    )
  }
}

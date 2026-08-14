import { accessLog } from '@server/http/middleware/access-log'
import { requestContext } from '@server/http/middleware/request-context'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('access log', () => {
  it('logs Hono-handled server errors with the original exception', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Hono()
    app.use('*', requestContext())
    app.use('*', accessLog())
    app.onError((_error, c) => c.json({ error: 'internal' }, 500))
    app.get('/failure', () => {
      throw new Error('Database exploded.')
    })

    const response = await app.request('/failure')

    expect(response.status).toBe(500)
    expect(info).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledOnce()
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      method: 'GET',
      event: 'request.complete',
      path: '/failure',
      status: 500,
      errorName: 'Error',
      errorMessage: 'Database exploded.',
    })
    expect(JSON.parse(error.mock.calls[0][0]).errorStack).toContain('Database exploded.')
    expect(response.headers.get('request-id')).toBeTruthy()
  })

  it('correlates a valid caller operation without trusting it as the request identity', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const app = new Hono()
    app.use('*', requestContext())
    app.use('*', accessLog())
    app.get('/ok', (c) => c.json({ ok: true }))

    const response = await app.request('/ok', { headers: { 'x-correlation-id': '0123456789abcdef0123456789abcdef' } })

    expect(response.status).toBe(200)
    const entry = JSON.parse(info.mock.calls[0][0])
    expect(entry.correlationId).toBe('0123456789abcdef0123456789abcdef')
    expect(entry.requestId).not.toBe(entry.correlationId)
  })
})

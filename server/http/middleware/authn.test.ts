import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'
import { authn, type SessionReader } from './authn'

it('leaves explicit authorization credentials for the resource authentication boundary', async () => {
  const getSession = vi.fn().mockResolvedValue(null)
  const app = new Hono()
    .use('*', authn({ api: { getSession } } satisfies SessionReader))
    .get('/api/resource', (c) => c.json({ ok: true }))

  const response = await app.request('/api/resource', {
    headers: { Authorization: 'DPoP access-token' },
  })

  expect(response.status).toBe(200)
  expect(getSession).not.toHaveBeenCalled()
})

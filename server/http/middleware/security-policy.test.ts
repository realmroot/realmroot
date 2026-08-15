import type { SecurityRepository } from '@server/usecases/ports'
import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'
import { securityPolicy } from '../routes/management.fixture-test-utils'
import { requireSecurityPolicy } from './security-policy'

it('uses the policy already resolved for the current request', async () => {
  const getPolicy = vi.fn()
  const repository = { getPolicy } as unknown as SecurityRepository
  const app = new Hono().use('*', requireSecurityPolicy(repository, securityPolicy())).get('/', (c) => c.text('ok'))

  expect((await app.request('/')).status).toBe(200)
  expect(getPolicy).not.toHaveBeenCalled()
})

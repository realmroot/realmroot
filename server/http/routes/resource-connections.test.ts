import { handleApiError } from '@server/http/errors'
import { depsMiddleware } from '@server/http/middleware/deps'
import { createResourceConnectionRoutes } from '@server/http/routes/resource-connections'
import * as externalResources from '@server/usecases/external-resources'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('Resource connection callback routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[spec: agent-identity/external-resource-first-access] returns provider errors to a retryable approval', async () => {
    const failIntent = vi
      .spyOn(externalResources, 'failResourceConnectionIntent')
      .mockResolvedValue({ returnTo: 'access-approval' })
    const app = new Hono()
      .use('*', depsMiddleware(createTestDeps()))
      .onError((error, c) => handleApiError(error, c))
      .route('/oauth/account-connection', createResourceConnectionRoutes('https://auth.example.com'))

    const response = await app.request(
      'https://auth.example.com/oauth/account-connection/callback?state=state-1&error=invalid_target&error_description=Workspace+resource+is+not+configured',
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin).toBe('https://auth.example.com')
    expect(location.pathname).toBe('/agent/access')
    expect(location.searchParams.get('resource_connection')).toBe('failed')
    expect(location.searchParams.get('error')).toBe('invalid_target')
    expect(location.searchParams.get('error_description')).toBe('Workspace resource is not configured')
    expect(failIntent).toHaveBeenCalledWith(expect.anything(), 'state-1')
  })
})

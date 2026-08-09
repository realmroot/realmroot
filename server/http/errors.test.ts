import {
  ApiError,
  badGateway,
  badRequest,
  forbidden,
  notFound,
  oauthError,
  resourceInUse,
  unauthorized,
} from '@server/domain/errors'
import { handleApiError } from '@server/http/errors'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it, vi } from 'vitest'

describe('API error boundary helpers', () => {
  it('creates typed API errors and serializes request IDs', async () => {
    expect(badRequest('Bad input')).toMatchObject({ status: 400, code: 'bad_request', message: 'Bad input' })
    expect(unauthorized()).toMatchObject({ status: 401, code: 'unauthorized', message: 'Authentication is required.' })
    expect(forbidden()).toMatchObject({ status: 403, code: 'forbidden', message: 'Admin access is required.' })
    expect(notFound()).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found.' })
    expect(resourceInUse('In use.', { scopeEntitlements: 1 })).toMatchObject({
      status: 409,
      code: 'resource_in_use',
      message: 'In use.',
      details: { scopeEntitlements: 1 },
    })
    expect(badGateway('Unavailable.', { stage: 'resource' })).toMatchObject({
      status: 502,
      code: 'bad_gateway',
      message: 'Unavailable.',
      details: { stage: 'resource' },
    })

    const response = handleApiError(new ApiError(400, 'bad_request', 'Invalid request.'), context())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'bad_request', message: 'Invalid request.', requestId: 'request-1' },
    })
  })

  it('maps HTTP exceptions and unknown errors through the same envelope', async () => {
    await expectError(new HTTPException(400, { message: 'Bad body.' }), 400, 'bad_request')
    await expectError(new HTTPException(401, { message: 'No session.' }), 401, 'unauthorized')
    await expectError(new HTTPException(403, { message: 'No access.' }), 403, 'forbidden')
    await expectError(new HTTPException(404, { message: 'Missing.' }), 404, 'not_found')
    await expectError(new HTTPException(409, { message: 'Conflict.' }), 409, 'conflict')
    await expectError(new HTTPException(502, { message: 'Upstream unavailable.' }), 502, 'bad_gateway')
    await expectError(new Error('Unexpected.'), 500, 'internal_error', 'Internal server error.')
  })

  it('serializes structured conflict details', async () => {
    const response = handleApiError(
      resourceInUse('API resource is in use.', {
        federatedCredentials: 0,
        accountConnections: 1,
        connectionIntents: 0,
        agentAccessRequests: 1,
        scopeEntitlements: 1,
      }),
      context(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'resource_in_use',
        message: 'API resource is in use.',
        requestId: 'request-1',
        details: {
          federatedCredentials: 0,
          accountConnections: 1,
          connectionIntents: 0,
          agentAccessRequests: 1,
          scopeEntitlements: 1,
        },
      },
    })
  })

  it('serializes OAuth and DPoP errors without the REST error envelope', async () => {
    const header = vi.fn()
    const c = context(header)
    const response = handleApiError(
      oauthError(
        'approval_required',
        'Controller approval is required.',
        400,
        { approval_id: 'approval-1', expires_in: 600 },
        { 'WWW-Authenticate': 'DPoP error="invalid_token"' },
      ),
      c,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'approval_required',
      error_description: 'Controller approval is required.',
      approval_id: 'approval-1',
      expires_in: 600,
    })
    expect(header).toHaveBeenCalledWith('WWW-Authenticate', 'DPoP error="invalid_token"')
  })
})

async function expectError(error: Error, status: number, code: string, message?: string) {
  const response = handleApiError(error, context())

  expect(response.status).toBe(status)
  await expect(response.json()).resolves.toEqual({
    error: { code, message: message ?? error.message, requestId: 'request-1' },
  })
}

function context(header = vi.fn()) {
  return {
    get: vi.fn().mockReturnValue({ id: 'request-1' }),
    header,
    json: (body: unknown, status: number) => Response.json(body, { status }),
  } as never
}

import { ApiError, badRequest, forbidden, notFound, oauthError, unauthorized } from '@server/domain/errors'
import { handleApiError } from '@server/http/errors'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it, vi } from 'vitest'

describe('API error boundary helpers', () => {
  it('creates typed API errors and serializes request IDs', async () => {
    expect(badRequest('Bad input')).toMatchObject({ status: 400, code: 'bad_request', message: 'Bad input' })
    expect(unauthorized()).toMatchObject({ status: 401, code: 'unauthorized', message: 'Authentication is required.' })
    expect(forbidden()).toMatchObject({ status: 403, code: 'forbidden', message: 'Admin access is required.' })
    expect(notFound()).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found.' })

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
    await expectError(new HTTPException(409, { message: 'Conflict.' }), 409, 'internal_error')
    await expectError(new Error('Unexpected.'), 500, 'internal_error', 'Internal server error.')
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

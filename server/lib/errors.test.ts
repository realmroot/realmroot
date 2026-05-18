import { HTTPException } from 'hono/http-exception'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, badRequest, forbidden, handleApiError, notFound, unauthorized } from './errors'

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
})

async function expectError(error: Error, status: number, code: string, message?: string) {
  const response = handleApiError(error, context())

  expect(response.status).toBe(status)
  await expect(response.json()).resolves.toEqual({
    error: { code, message: message ?? error.message, requestId: 'request-1' },
  })
}

function context() {
  return {
    get: vi.fn().mockReturnValue({ id: 'request-1' }),
    json: (body: unknown, status: number) => Response.json(body, { status }),
  } as never
}

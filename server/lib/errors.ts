import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'internal_error'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message)
export const unauthorized = (message = 'Authentication is required.') => new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'Admin access is required.') => new ApiError(403, 'forbidden', message)
export const notFound = (message = 'Resource not found.') => new ApiError(404, 'not_found', message)

export function handleApiError(error: Error, c: Context) {
  if (error instanceof ApiError) {
    return errorResponse(c, error.status, error.code, error.message)
  }

  if (error instanceof HTTPException) {
    return errorResponse(c, error.status, statusCode(error.status), error.message)
  }

  return errorResponse(c, 500, 'internal_error', 'Internal server error.')
}

function errorResponse(c: Context, status: number, code: ErrorCode, message: string) {
  return c.json(
    {
      error: {
        code,
        message,
        requestId: c.get('requestContext')?.id,
      },
    },
    status as ContentfulStatusCode,
  )
}

function statusCode(status: number): ErrorCode {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  return 'internal_error'
}

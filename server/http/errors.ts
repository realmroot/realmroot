import { ApiError, type ErrorCode, OAuthError } from '@server/domain/errors'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export function handleApiError(error: Error, c: Context) {
  if (error instanceof OAuthError) {
    for (const [name, value] of Object.entries(error.headers)) c.header(name, value)
    return c.json(
      {
        error: error.error,
        error_description: error.errorDescription,
        ...error.parameters,
      },
      error.status as ContentfulStatusCode,
    )
  }
  if (error instanceof ApiError) {
    return errorResponse(c, error.status, error.code, error.message, error.details)
  }

  if (error instanceof HTTPException) {
    return errorResponse(c, error.status, statusCode(error.status), error.message)
  }

  return errorResponse(c, 500, 'internal_error', 'Internal server error.')
}

function errorResponse(
  c: Context,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return c.json(
    {
      error: {
        code,
        message,
        requestId: c.get('requestContext')?.id,
        ...(details ? { details } : {}),
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
  if (status === 409) return 'conflict'
  if (status === 502) return 'bad_gateway'
  return 'internal_error'
}

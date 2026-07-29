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

export class OAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string,
    public readonly errorDescription: string,
    public readonly parameters: Record<string, unknown> = {},
    public readonly headers: Record<string, string> = {},
  ) {
    super(errorDescription)
    this.name = 'OAuthError'
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message)
export const unauthorized = (message = 'Authentication is required.') => new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'Admin access is required.') => new ApiError(403, 'forbidden', message)
export const notFound = (message = 'Resource not found.') => new ApiError(404, 'not_found', message)
export const oauthError = (
  error: string,
  description: string,
  status = 400,
  parameters: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) => new OAuthError(status, error, description, parameters, headers)

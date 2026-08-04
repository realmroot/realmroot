export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'gone'
  | 'conflict'
  | 'resource_in_use'
  | 'precondition_failed'
  | 'precondition_required'
  | 'bad_gateway'
  | 'internal_error'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
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
export const gone = (message: string) => new ApiError(410, 'gone', message)
export const conflict = (message: string) => new ApiError(409, 'conflict', message)
export const resourceInUse = (message: string, details: Record<string, unknown>) =>
  new ApiError(409, 'resource_in_use', message, details)
export const preconditionFailed = (message: string) => new ApiError(412, 'precondition_failed', message)
export const preconditionRequired = (message: string) => new ApiError(428, 'precondition_required', message)
export const badGateway = (message: string, details?: Record<string, unknown>) =>
  new ApiError(502, 'bad_gateway', message, details)
export const oauthError = (
  error: string,
  description: string,
  status = 400,
  parameters: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) => new OAuthError(status, error, description, parameters, headers)

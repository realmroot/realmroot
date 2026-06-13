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

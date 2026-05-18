import { ApiError } from '../lib/errors'

export type AuthEndpoint<TInput, TOutput> = (input: TInput) => Promise<TOutput>

export interface ManagementAuthApi {
  listUsers: AuthEndpoint<{ query: Record<string, unknown>; headers: Headers }, unknown>
  getUser: AuthEndpoint<{ query: { id: string }; headers: Headers }, unknown>
  createUser: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  adminUpdateUser: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  banUser: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  unbanUser: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  removeUser: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  listUserSessions: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  revokeUserSession: AuthEndpoint<{ body: { sessionToken: string }; headers: Headers }, unknown>
  revokeUserSessions: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  requestPasswordReset: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  sendVerificationEmail: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  changeEmail: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  changePassword: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
}

export function toBoundaryError(error: unknown): Error {
  if (isBetterAuthApiError(error)) {
    return new ApiError(error.statusCode, statusCode(error.statusCode), error.body?.message ?? error.message)
  }

  return error instanceof Error ? error : new Error('Unexpected error.')
}

function isBetterAuthApiError(error: unknown): error is {
  statusCode: number
  message: string
  body?: { message?: string }
} {
  return typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
}

function statusCode(status: number) {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  return 'internal_error'
}

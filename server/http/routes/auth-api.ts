import { ApiError } from '@server/domain/errors'

export type AuthEndpoint<TInput, TOutput> = (input: TInput) => Promise<TOutput>
export type AuthResponseEndpoint<TInput> = (input: TInput & { asResponse: true }) => Promise<Response>

export interface ManagementAuthApi {
  signJWT?: (context: {
    body: { payload: Record<string, unknown>; overrideOptions?: { jwt?: { type?: string } } }
    asResponse: false
  }) => Promise<{ token: string }>
  listSessions: AuthEndpoint<{ headers: Headers }, unknown>
  revokeSession: AuthEndpoint<{ body: { token: string }; headers: Headers }, unknown>
  revokeSessions: AuthEndpoint<{ headers: Headers }, unknown>
  revokeOtherSessions: AuthEndpoint<{ headers: Headers }, unknown>
  requestPasswordReset: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  sendVerificationEmail: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  changeEmail: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  requestEmailChangeEmailOTP: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  changeEmailEmailOTP: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  changePassword: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  enableTwoFactor: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  disableTwoFactor: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  verifyTOTP: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  generateBackupCodes: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  listPasskeys: AuthEndpoint<{ headers: Headers }, unknown>
  deletePasskey: AuthEndpoint<{ body: { id: string }; headers: Headers }, unknown>
  updatePasskey: AuthEndpoint<{ body: { id: string; name: string }; headers: Headers }, unknown>
  linkSocialAccount: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  oAuth2LinkAccount: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  unlinkAccount: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
}

export function toBoundaryError(error: unknown): Error {
  if (isBetterAuthApiError(error)) {
    return new ApiError(error.statusCode, statusCode(error.statusCode), errorMessage(error))
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

function errorMessage(error: { statusCode: number; message: string; body?: { message?: string } }) {
  if (error.statusCode >= 500) return 'Internal server error.'
  return error.body?.message ?? error.message
}

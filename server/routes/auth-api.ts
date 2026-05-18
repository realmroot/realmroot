import { ApiError } from '../lib/errors'

export type AuthEndpoint<TInput, TOutput> = (input: TInput) => Promise<TOutput>
export type AuthResponseEndpoint<TInput> = (input: TInput & { asResponse: true }) => Promise<Response>

export interface ManagementAuthApi {
  listUsers: AuthEndpoint<{ query: Record<string, unknown>; headers: Headers }, unknown>
  getUser: AuthEndpoint<{ query: { id: string }; headers: Headers }, unknown>
  createUser: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  adminUpdateUser: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  banUser: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  unbanUser: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  removeUser: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  listUserSessions: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  listSessions: AuthEndpoint<{ headers: Headers }, unknown>
  revokeSession: AuthEndpoint<{ body: { token: string }; headers: Headers }, unknown>
  revokeSessions: AuthEndpoint<{ headers: Headers }, unknown>
  revokeUserSession: AuthEndpoint<{ body: { sessionToken: string }; headers: Headers }, unknown>
  revokeUserSessions: AuthEndpoint<{ body: { userId: string }; headers: Headers }, unknown>
  requestPasswordReset: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  sendVerificationEmail: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  changeEmail: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  changePassword: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  enableTwoFactor: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  disableTwoFactor: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  verifyTOTP: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  sendTwoFactorOTP: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  verifyTwoFactorOTP: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  generateBackupCodes: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  listPasskeys: AuthEndpoint<{ headers: Headers }, unknown>
  generatePasskeyRegistrationOptions: AuthEndpoint<{ query: Record<string, unknown>; headers: Headers }, unknown>
  verifyPasskeyRegistration: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  deletePasskey: AuthEndpoint<{ body: { id: string }; headers: Headers }, unknown>
  updatePasskey: AuthEndpoint<{ body: { id: string; name: string }; headers: Headers }, unknown>
  linkSocialAccount: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  oAuth2LinkAccount: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
  unlinkAccount: AuthEndpoint<{ body: Record<string, unknown>; headers: Headers }, unknown>
}

export interface ExperienceAuthApi {
  signInEmail: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  signInUsername: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  signUpEmail: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  signOut: AuthResponseEndpoint<{ headers: Headers }>
  requestPasswordReset: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  resetPassword: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  sendVerificationEmail: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  verifyEmail: AuthResponseEndpoint<{ query: Record<string, unknown>; headers: Headers }>
  signInMagicLink: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  sendVerificationOTP: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  signInEmailOTP: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  verifyEmailOTP: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  requestPasswordResetEmailOTP: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  resetPasswordEmailOTP: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
  isUsernameAvailable: AuthResponseEndpoint<{ body: Record<string, unknown>; headers: Headers }>
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

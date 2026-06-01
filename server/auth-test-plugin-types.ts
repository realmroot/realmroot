export type EmailOtpPluginOptions = {
  otpLength?: number
  expiresIn?: number
  changeEmail?: {
    enabled: boolean
    verifyCurrentEmail: boolean
  }
  sendVerificationOTP: (input: { email: string; otp: string; type: string }) => Promise<void>
}

export type PhonePluginOptions = {
  otpLength?: number
  expiresIn?: number
  requireVerification?: boolean
  signUpOnVerification?: unknown
  sendOTP: (input: { phoneNumber: string; code: string }) => Promise<void>
  sendPasswordResetOTP?: (input: { phoneNumber: string; code: string }) => Promise<void>
}

export type OneTapPluginOptions = {
  clientId?: string
  disableSignup?: boolean
}

export type SiwePluginOptions = {
  domain: string
  emailDomainName?: string
  anonymous?: boolean
  getNonce: () => Promise<string>
}

export type OrganizationPluginOptions = {
  sendInvitationEmail: (input: { email: string; id: string; inviter: { user: unknown } }) => Promise<void>
}

export type UsernamePluginOptions = {
  minUsernameLength: number
  maxUsernameLength: number
  usernameValidator: (value: string) => boolean
}

export type PasskeyPluginOptions = {
  rpID: string
  rpName: string
  origin: string[]
}

export type TwoFactorPluginOptions = {
  issuer: string
  allowPasswordless: boolean
  otpOptions?: unknown
  totpOptions?: unknown
}

export type OAuthProviderPluginOptions = {
  clientRegistrationAllowedScopes: readonly string[]
  customUserInfoClaims: (input: {
    user: unknown
    scopes: string[]
    jwt: Record<string, unknown>
  }) => Promise<Record<string, unknown>>
}

export type AgentAuthPluginOptions = {
  providerName: string
  modes: string[]
  approvalMethods: string[]
  deviceAuthorizationPage: string
  allowDynamicHostRegistration: boolean
  defaultHostCapabilities: string[]
  requireAuthForCapabilities: boolean
  capabilities: Array<{ name: string }>
  validateCapabilities: (capabilities: string[]) => boolean
  resolveAutonomousUser?: unknown
}

export type DeviceAuthorizationPluginOptions = {
  verificationUri: string
  validateClient: (clientId: string) => Promise<boolean> | boolean
  onDeviceAuthRequest: (clientId: string, scope?: string) => Promise<void> | void
}

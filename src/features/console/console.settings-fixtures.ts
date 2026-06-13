export const signInSettings = {
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    emailOtpEnabled: false,
    socialLoginEnabled: true,
    usernameEnabled: true,
    identifierFirst: false,
  },
  builtInProviders: {
    email: {
      enabled: true,
      otpLength: 6,
      expiresInSeconds: 300,
    },
    phone: {
      enabled: false,
      smsProvider: 'twilio',
      otpLength: 6,
      expiresInSeconds: 300,
      signUpOnVerification: false,
      requireVerification: true,
      twilioAccountSid: '',
      twilioAuthToken: '',
      twilioFromNumber: '',
      vonageApiKey: '',
      vonageApiSecret: '',
      vonageFrom: '',
      messageBirdAccessKey: '',
      messageBirdOriginator: '',
    },
    web3Wallet: {
      enabled: false,
      chains: [1],
      domain: '',
      emailDomainName: '',
      allowSignUp: true,
      ensLookupEnabled: false,
    },
    passkey: {
      allowSignUp: true,
    },
    oneTap: {
      enabled: false,
      clientId: '',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
      disableSignUp: false,
    },
  },
  links: {
    termsUri: 'https://example.com/terms',
    privacyUri: 'https://example.com/privacy',
    supportEmail: 'support@example.com',
  },
  copy: {
    productName: 'Acme Auth',
    headline: 'Sign in to Acme Auth',
    description: 'Continue with your Acme identity.',
  },
}

export const brandingSettings = {
  branding: {
    logoUrl: 'https://cdn.example.com/logo.svg',
    faviconUrl: 'https://cdn.example.com/favicon.ico',
    primaryColor: '#2563eb',
    backgroundColor: '#ffffff',
    customCss: '--auth-panel-radius: 8px;',
  },
  copy: signInSettings.copy,
}

export const accountCenterSettings = {
  accountCenter: {
    profileEditingEnabled: true,
    displayNameEditable: true,
    usernameEditable: true,
    avatarEditable: true,
    emailChangeEnabled: true,
    passwordChangeEnabled: true,
    connectedAccountsEnabled: true,
    sessionsViewEnabled: true,
    dangerZoneEnabled: false,
  },
}

export const securityPolicy = {
  policy: {
    mfa: { mode: 'required' },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'Acme Auth',
      origins: ['https://auth.example.com'],
    },
    sessions: {
      expiresInSeconds: 3600,
      updateAgeSeconds: 300,
      freshAgeSeconds: 120,
      cookieCacheSeconds: 60,
    },
    password: {
      minLength: 12,
      requiredCharacterTypes: 2,
      customWords: [],
      rejectUserInfo: true,
      rejectSequential: true,
      rejectCustomWords: false,
    },
    captcha: {
      enabled: false,
      provider: 'turnstile',
      siteKey: '',
      secretBinding: '',
    },
    blocklist: {
      blockSubaddressing: false,
      entries: [],
    },
  },
}

export const readinessIncomplete = {
  required: [
    {
      id: 'oidc_application',
      label: 'Create an OIDC application',
      description: 'Register the first client so product routes can complete authorization code flows.',
      status: 'action_needed',
      href: '/console/onboarding',
      action: 'Create client',
    },
    {
      id: 'sign_in_method',
      label: 'Enable a sign-in method',
      description: 'Keep at least one hosted sign-in method available for users.',
      status: 'complete',
      href: '/console/sign-in-experience/sign-up-and-sign-in',
      action: 'Review methods',
    },
  ],
  recommended: [
    {
      id: 'email_delivery',
      label: 'Confirm email delivery',
      description: 'Email binding and sender settings are needed for verification, OTP, and reset flows.',
      status: 'action_needed',
      href: '/console/tenant-settings/oidc-configs',
      action: 'Review deployment',
    },
  ],
  admin: { setupRequired: true, setupHref: '/console/onboarding', missing: ['oidc_application'] },
}

export const accountSecurity = {
  mfa: { enabled: false, factors: [] },
  passkeys: { enabled: true, count: 0 },
  policy: {
    mfa: { mode: 'optional' },
    passkeys: { enabled: true, rpName: 'Acme Auth' },
  },
}

export const consoleSecurity = {
  userId: 'user-1',
  mfa: { enabled: true, factors: [{ id: 'factor-1', type: 'totp', verified: true }] },
  passkeys: { enabled: true, count: 1 },
  policy: {
    mfa: { mode: 'required' },
    passkeys: { enabled: true, rpName: 'Acme Auth' },
  },
}

export const consolePasskey = {
  id: 'passkey-1',
  name: 'MacBook Touch ID',
  userId: 'user-1',
  deviceType: 'singleDevice',
  backedUp: true,
  transports: 'internal',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const consoleSession = {
  id: 'session-1',
  expiresAt: '2026-01-01T01:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:30:00.000Z',
  ipAddress: '127.0.0.1',
  userAgent: 'Chrome',
  activeOrganizationId: null,
}

export const linkedAccount = {
  id: 'account-1',
  accountId: 'github-jane',
  providerId: 'github',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const userApplication = {
  id: 'grant-1',
  applicationId: 'app-1',
  applicationName: 'Customer portal',
  applicationSlug: 'customer-portal',
  scopes: ['openid', 'profile'],
  permissions: ['read:profile'],
  grantedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
}

export const configz = {
  onboarding: { required: false, href: '/onboarding' },
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: false,
    emailOtpEnabled: true,
    usernameEnabled: false,
    identifierFirst: false,
  },
  builtInProviders: {
    email: { enabled: true },
    phone: { enabled: false },
    web3Wallet: { enabled: false, chains: [1], allowSignUp: true },
    passkey: { allowSignUp: true },
    oneTap: {
      enabled: false,
      clientId: '',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
    },
  },
  branding: {
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    backgroundColor: null,
    customCss: null,
  },
  identityProviders: [],
  links: {
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
  },
  copy: {
    productName: 'Acme',
    headline: 'Sign in to Acme.',
    description: 'Use your workspace identity.',
  },
  auth: {
    basePath: '/api/auth',
    signInEmailPath: '/api/auth/sign-in/email',
    signInUsernamePath: '/api/auth/sign-in/username',
    signUpEmailPath: '/api/auth/sign-up/email',
    signOutPath: '/api/auth/sign-out',
    requestPasswordResetPath: '/api/auth/request-password-reset',
    resetPasswordPath: '/api/auth/reset-password',
    sendVerificationEmailPath: '/api/auth/send-verification-email',
    verifyEmailPath: '/api/auth/verify-email',
    emailOtpPath: '/api/auth/email-otp/send-verification-otp',
    emailOtpSignInPath: '/api/auth/sign-in/email-otp',
    emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
    emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
    emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
  },
  oidc: {
    issuer: 'https://auth.example.com/api/auth',
    discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
    authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
    tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
    jwksUri: 'https://auth.example.com/api/auth/jwks',
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  },
  security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
  accountCenter: accountCenterSettings.accountCenter,
}

import type { ConfigzConfigResponse } from '@shared/api/configz'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthLayout, BrandIdentity, brandingStyle } from './auth-layout'

const config: ConfigzConfigResponse = {
  onboarding: { required: false, href: '/onboarding' },
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: true,
    identifierFirst: false,
  },
  branding: {
    logoUrl: 'https://cdn.example.com/logo.svg',
    faviconUrl: 'https://cdn.example.com/favicon.ico',
    primaryColor: '#2563eb',
    backgroundColor: '#ffffff',
    customCss: '--auth-panel-radius: 12px;',
  },
  identityProviders: [],
  links: {
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
  },
  copy: {
    productName: 'Acme ID',
    headline: 'Sign in to Acme',
    description: 'Continue securely.',
  },
  defaults: {
    applicationId: null,
    redirectUri: null,
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
    magicLinkPath: '/api/auth/sign-in/magic-link',
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
  security: {
    mfaRequired: false,
    sessionExpiresInSeconds: 3600,
    passkeysEnabled: true,
  },
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
  captcha: {
    enabled: false,
    provider: 'turnstile',
    siteKey: '',
  },
}

afterEach(() => {
  cleanup()
  document.querySelectorAll('link[rel="icon"]').forEach((link) => {
    link.remove()
  })
})

describe('AuthLayout', () => {
  it('applies branding, constrained custom properties, and favicon', () => {
    render(
      <AuthLayout config={config} description="Description" eyebrow="Hosted sign-in" title="Welcome">
        Form
      </AuthLayout>,
    )

    const shell = screen.getByRole('main', { name: 'Hosted authentication' })
    expect(shell.getAttribute('style')).toContain('--brand-primary: #2563eb')
    expect(shell.getAttribute('style')).toContain('--auth-panel-radius: 12px')
    expect(screen.getByRole('region', { name: 'Welcome' })).toBeTruthy()
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toBe(
      'https://cdn.example.com/favicon.ico',
    )
    expect(screen.getByText('Acme ID')).toBeTruthy()
    expect(screen.getByText('Hosted sign-in')).toBeTruthy()
    expect(screen.getByText('Form')).toBeTruthy()
  })

  it('returns default brand style when config is not loaded', () => {
    expect(brandingStyle(null)).toMatchObject({
      '--brand-primary': '#b42318',
      '--brand-background': '#f7f3ee',
    })
  })

  it('renders fallback branding when config copy is unavailable', () => {
    render(<BrandIdentity config={{ branding: { logoUrl: null } } as never} />)

    expect(screen.getByText('FlareAuth')).toBeTruthy()
    expect(screen.getByText('F')).toBeTruthy()
  })

  it('renders configured logo branding and optional eyebrow', () => {
    const { container } = render(
      <AuthLayout
        config={{ ...config, branding: { ...config.branding, logoUrl: 'https://cdn.example.com/logo.png' } }}
        description="Hosted identity"
        eyebrow="Secure access"
        title="Sign in"
      >
        <button type="button">Continue</button>
      </AuthLayout>,
    )

    expect(screen.getByText('Acme ID')).toBeTruthy()
    expect(screen.getByText('Secure access')).toBeTruthy()
    expect(container.querySelector('img.brandLogo')?.getAttribute('width')).toBe('36')
    expect(container.querySelector('img.brandLogo')?.getAttribute('height')).toBe('36')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('renders configured legal and support links', () => {
    render(
      <AuthLayout
        config={{
          ...config,
          links: {
            termsUri: 'https://client.example.com/terms',
            privacyUri: 'https://client.example.com/privacy',
            supportEmail: 'support@client.example.com',
          },
        }}
        description="Hosted identity"
        title="Sign in"
      >
        <button type="button">Continue</button>
      </AuthLayout>,
    )

    expect(screen.getByRole('navigation', { name: 'Hosted authentication legal links' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('https://client.example.com/terms')
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
      'https://client.example.com/privacy',
    )
    expect(screen.getByRole('link', { name: 'Support' }).getAttribute('href')).toBe('mailto:support@client.example.com')
  })

  it('renders compact message states with a back link and icon', () => {
    render(
      <AuthLayout
        backHref="/sign-in"
        config={config}
        description="This request is no longer available."
        icon={<span aria-hidden="true">!</span>}
        title="Request expired."
        variant="message"
      >
        <p>Start again from the application.</p>
      </AuthLayout>,
    )

    expect(screen.getByRole('main', { name: 'Hosted authentication' }).className).toContain('authShell-message')
    expect(screen.getByRole('region', { name: 'Request expired.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/sign-in')
    expect(screen.getByText('!').closest('.authMessageIcon')).toBeTruthy()
    expect(screen.queryByText('Acme ID')).toBeNull()
  })

  it('omits the eyebrow when one is not provided', () => {
    render(
      <AuthLayout config={null} description="Hosted identity" title="Sign in">
        <span>Form slot</span>
      </AuthLayout>,
    )

    expect(screen.queryByText('Secure access')).toBeNull()
    expect(screen.getByText('Form slot')).toBeTruthy()
  })
})

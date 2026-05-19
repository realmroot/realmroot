import { expect, test, type Page, type Route } from '@playwright/test'
import fs from 'node:fs'
import { createApp } from '../../server/app'

const journeyCoverage = JSON.parse(fs.readFileSync(new URL('./journey-coverage.json', import.meta.url), 'utf8')) as {
  target: number
  honoRpcSmokeJourneys: string[]
  journeys: Array<{ id: string; name: string }>
  waivers: unknown[]
}

type RequestRecord = {
  method: string
  path: string
  body: unknown
}

type JourneyContext = {
  page: Page
  requests: RequestRecord[]
}

type JourneyId = (typeof journeyCoverage.journeys)[number]['id']

let firstAdminRequired = false
let adminSetupRequired = false
let accountSignedIn = true
let applicationDisabled = false
let identifierFirstRequired = false

const journeyAssertions: Record<
  JourneyId,
  {
    suite:
      | 'public and auth journeys'
      | 'OAuth consent journey'
      | 'account center journey'
      | 'admin management journeys'
    assert: (context: JourneyContext) => Promise<void>
  }
> = {
  'platform-status': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'One auth service for every app on your edge.' })).toBeVisible()
      await expect(page.getByText('API status: online')).toBeVisible()
    },
  },
  'first-admin-gate': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      firstAdminRequired = true
      try {
        await page.goto('/account/security')
        await expect(page).toHaveURL(/\/onboarding$/)
        await expect(page.getByRole('heading', { name: 'Create the first admin.' })).toBeVisible()
      } finally {
        firstAdminRequired = false
      }
    },
  },
  'public-onboarding': {
    suite: 'public and auth journeys',
    assert: async ({ page, requests }) => {
      firstAdminRequired = true
      try {
        await page.goto('/onboarding')
        await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Admin User')
        await page.getByLabel('Email').fill('admin@example.com')
        await page.getByLabel('Username').fill('admin')
        await page.getByLabel('Password').fill('password-1')
        await page.getByRole('button', { name: 'Create first admin' }).click()
        await expect(page.getByText('First admin created.')).toBeVisible()
        await expect(page.getByLabel('Password')).toHaveCount(0)
        expect(requests).toContainEqual({
          method: 'POST',
          path: '/api/onboarding/admin-users',
          body: { email: 'admin@example.com', name: 'Admin User', password: 'password-1', username: 'admin' },
        })
      } finally {
        firstAdminRequired = false
      }
    },
  },
  'public-sign-in': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/sign-in')
      await expect(page.getByRole('heading', { name: 'Sign in to Acme.' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Password' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'OTP' })).toBeVisible()
    },
  },
  'oidc-hosted-sign-in-context': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback')
      await expect(page.getByRole('heading', { name: 'Continue to client.example.com.' })).toBeVisible()
      await expect(page.getByText('Sign in with your hosted account to continue to client.example.com.')).toBeVisible()
      await expect(page.getByText('client-1')).toHaveCount(0)
    },
  },
  'identifier-first-sign-in': {
    suite: 'public and auth journeys',
    assert: async ({ page, requests }) => {
      identifierFirstRequired = true
      try {
        await page.goto('/sign-in')
        await page.getByLabel('Email or username').fill('jane@example.com')
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByText('Signing in as')).toBeVisible()
        await page.getByRole('button', { name: 'OTP' }).click()
        await page.getByRole('button', { name: 'Send code' }).click()
        expect(requests).toContainEqual({
          method: 'POST',
          path: '/api/auth/email-otp/send-verification-otp',
          body: { email: 'jane@example.com', type: 'sign-in' },
        })
        await page.getByRole('button', { name: 'Change' }).click()
        await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
      } finally {
        identifierFirstRequired = false
      }
    },
  },
  'signed-out-account-redirect': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      accountSignedIn = false
      try {
        for (const path of [
          '/account',
          '/account/profile',
          '/account/security',
          '/account/linked-accounts',
          '/account/sessions',
          '/account/authorized-apps',
        ]) {
          await page.goto(path)
          await expect(page.getByRole('heading', { name: 'Sign in to Acme.' })).toBeVisible()
          const url = new URL(page.url())
          expect(url.pathname).toBe('/sign-in')
          expect(url.searchParams.get('return_to')).toBe(path)
          await expect(page.getByRole('navigation', { name: 'Account center' })).toHaveCount(0)
        }
      } finally {
        accountSignedIn = true
      }
    },
  },
  'password-sign-in': {
    suite: 'public and auth journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/sign-in')
      await page.getByLabel('Email or username').fill('jane@example.com')
      await page.getByLabel('Password').fill('password-1')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/account\/profile$/)
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/auth/sign-in/email',
        body: { email: 'jane@example.com', password: 'password-1', rememberMe: true },
      })
    },
  },
  'password-recovery': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/forgot-password')
      await page.getByRole('button', { name: 'OTP code' }).click()
      await page.getByLabel('Email').fill('jane@example.com')
      await page.getByRole('button', { name: 'Send reset code' }).click()
      await expect(page.getByText('Password reset code sent.')).toBeVisible()
      await page.getByLabel('One-time code').fill('123456')
      await page.getByLabel('New password').fill('new-password')
      await page.getByRole('button', { name: 'Reset password' }).click()
    },
  },
  'email-verification': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/email-verification')
      await page.getByRole('textbox', { name: 'Email' }).fill('jane@example.com')
      await page.getByRole('button', { name: 'Send verification' }).click()
      await expect(page.getByText('Verification email sent.')).toBeVisible()
      await page.getByLabel('One-time code').fill('654321')
      await page.getByRole('button', { name: 'Verify email' }).click()
    },
  },
  'sign-up': {
    suite: 'public and auth journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/sign-up')
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Jane Stone')
      await page.getByLabel('Email').fill('jane@example.com')
      await page.getByLabel('Username').fill('jane')
      await page.getByLabel('Password').fill('password-1')
      await page.getByRole('button', { name: 'Create account' }).click()
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/auth/sign-up/email',
        body: {
          email: 'jane@example.com',
          name: 'Jane Stone',
          password: 'password-1',
          username: 'jane',
        },
      })
    },
  },
  'magic-link': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/sign-in')
      await page.getByRole('button', { name: 'Magic link' }).click()
      await page.getByLabel('Email').fill('jane@example.com')
      await page.getByRole('button', { name: 'Send magic link' }).click()
    },
  },
  'email-otp-sign-in': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/sign-in')
      await page.getByRole('button', { name: 'OTP' }).click()
      await page.getByLabel('Email').fill('jane@example.com')
      await page.getByRole('button', { name: 'Send code' }).click()
      await page.getByLabel('One-time code').fill('123456')
      await page.getByRole('button', { name: 'Verify code' }).click()
    },
  },
  'oauth-consent': {
    suite: 'OAuth consent journey',
    assert: async ({ page, requests }) => {
      await page.goto(
        '/oauth/consent?client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foidc%2Fcallback&response_type=code&scope=openid%20profile&state=state-1&code_challenge=challenge-1&code_challenge_method=S256&nonce=nonce-1',
      )
      await expect(page.getByRole('heading', { name: 'Customer portal' })).toBeVisible()
      await expect(page.getByText('Signed in as')).toBeVisible()
      await expect(page.getByText('Jane Stone')).toBeVisible()
      await page.getByRole('button', { name: 'Approve access' }).click()
      await expect(page).toHaveURL(/\/oidc\/callback\?code=demo-code&state=state-1/)
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/oauth/consent',
        body: { clientId: 'client-1', scopes: ['openid', 'profile'] },
      })
    },
  },
  'oauth-consent-deny': {
    suite: 'OAuth consent journey',
    assert: async ({ page }) => {
      await page.goto(
        '/oauth/consent?client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foidc%2Fcallback&state=state-1',
      )
      await page.getByRole('link', { name: 'Deny' }).click()
      await expect(page).toHaveURL(/\/oidc\/callback\?error=access_denied&state=state-1/)
      await expect(page.getByRole('heading', { name: 'Demo client callback' })).toBeVisible()
    },
  },
  'oidc-client-callback': {
    suite: 'OAuth consent journey',
    assert: async ({ page }) => {
      const oidcPage = await page.context().newPage()
      await mockApi(oidcPage)
      try {
        await oidcPage.goto('/oidc/start?client_id=client-1&redirect_uri=http%3A%2F%2Flocalhost%3A4173%2Foidc%2Fcallback')
        await expect(oidcPage.getByRole('heading', { name: 'Demo client callback' })).toBeVisible()
        await expect(oidcPage.getByText(/code=demo-code&state=/)).toBeVisible()
      } finally {
        await oidcPage.close()
      }
    },
  },
  'account-center': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account')
      await expect(page.getByRole('heading', { name: 'Jane Stone' })).toBeVisible()
      await expect(page).toHaveURL(/\/account\/profile$/)
    },
  },
  'account-deep-links': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account/security')
      await expect(page.getByRole('heading', { name: 'MFA' })).toBeVisible()
      await page.getByRole('link', { name: 'Linked accounts' }).click()
      await expect(page).toHaveURL(/\/account\/linked-accounts$/)
      await expect(page.getByRole('heading', { name: 'Linked social accounts' })).toBeVisible()
      await page.getByRole('link', { name: 'Sessions' }).click()
      await expect(page).toHaveURL(/\/account\/sessions$/)
      await expect(page.getByRole('heading', { name: 'Sessions and devices' })).toBeVisible()
      await page.getByRole('link', { name: 'Authorized apps' }).click()
      await expect(page).toHaveURL(/\/account\/authorized-apps$/)
      await expect(page.getByRole('heading', { name: 'Consented applications' })).toBeVisible()
    },
  },
  'profile-update': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account')
      await page.getByLabel('Display name').fill('Jane Q. Stone')
      await page.getByRole('button', { name: 'Save profile' }).click()
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/account/profile',
        body: { displayName: 'Jane Q. Stone', username: 'jane', avatarAssetId: null },
      })
    },
  },
  'email-update': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account')
      await page.getByLabel('Email').fill('jane.new@example.com')
      await page.getByRole('button', { name: 'Change email' }).click()
    },
  },
  'password-update': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account')
      await page.getByLabel('Current password').fill('password-1')
      await page.getByLabel('New password').fill('new-password')
      await page.getByRole('button', { name: 'Change password' }).click()
    },
  },
  'totp-flow': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account/security')
      await page.getByLabel('Password').fill('password-1')
      await page.getByRole('button', { name: 'Enroll authenticator app' }).click()
      await expect(page.getByText('Authenticator setup')).toBeVisible()
      await page.getByLabel('Authenticator code').fill('123456')
      await page.getByRole('button', { name: 'Verify code' }).click()
    },
  },
  'passkey-flow': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account/security')
      await page.getByLabel('Passkey name').fill('MacBook Touch ID')
      await page.getByRole('button', { name: 'Add passkey' }).click()
    },
  },
  'linked-account-unlink': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account/linked-accounts')
      await page.getByRole('button', { name: 'Unlink' }).click()
    },
  },
  'session-revocation': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account/sessions')
      await page.getByRole('button', { name: 'Revoke all' }).click()
      await page.getByRole('button', { name: 'Revoke', exact: true }).click()
      expect(requests).toContainEqual({ method: 'DELETE', path: '/api/account/security/sessions', body: null })
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/account/security/sessions/session-1',
        body: null,
      })
    },
  },
  'sign-out': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      await page.goto('/account')
      await page.getByRole('button', { name: 'Sign out' }).click()
    },
  },
  'admin-dashboard': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin')
      await expect(page.getByRole('heading', { name: 'Tenant health' })).toBeVisible()
    },
  },
  'admin-setup-gate': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      adminSetupRequired = true
      try {
        await page.goto('/admin/applications')
        await expect(page).toHaveURL(/\/admin\/onboarding$/)
        await expect(page.getByRole('heading', { name: 'Admin onboarding' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Admin' }).getByText('Onboarding')).toHaveCount(0)
      } finally {
        adminSetupRequired = false
      }
    },
  },
  'admin-onboarding': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      adminSetupRequired = true
      try {
        await page.goto('/admin/onboarding')
        await expect(page.getByRole('heading', { name: 'Admin onboarding' })).toBeVisible()
        await page.getByLabel('Application name').fill('Review client')
        await page.getByLabel('Slug').fill('review-client')
        await page.getByLabel('Redirect URIs').fill('http://localhost:4173/oidc/callback')
        await page.getByRole('button', { name: 'Create OIDC client' }).click()
        await expect(page.getByText('Client ID')).toBeVisible()
        await expect(page.getByText('http://localhost:4173/oidc/callback').nth(1)).toBeVisible()
        expect(requests).toContainEqual({
          method: 'POST',
          path: '/api/management/applications',
          body: {
            name: 'Review client',
            slug: 'review-client',
            clientType: 'public_spa',
            redirectUris: ['http://localhost:4173/oidc/callback'],
          },
        })
      } finally {
        adminSetupRequired = false
      }
    },
  },
  'admin-route-backed-navigation': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin')
      const adminNav = page.getByRole('navigation', { name: 'Admin' })
      await expect(adminNav.getByText('Onboarding')).toHaveCount(0)

      for (const item of [
        { label: 'Dashboard', href: '/admin', heading: 'Tenant health' },
        { label: 'Applications', href: '/admin/applications', heading: 'Applications' },
        { label: 'Users', href: '/admin/users', heading: 'Users' },
        { label: 'Connectors', href: '/admin/connectors', heading: 'Connectors' },
        { label: 'Sign-in experience', href: '/admin/sign-in', heading: 'Sign-in experience' },
        { label: 'Security', href: '/admin/security', heading: 'Security' },
        { label: 'Organizations', href: '/admin/organizations', heading: 'Organizations' },
        { label: 'Roles', href: '/admin/roles', heading: 'Roles' },
        { label: 'API resources', href: '/admin/api-resources', heading: 'API resources' },
        { label: 'Branding', href: '/admin/branding', heading: 'Branding' },
        { label: 'Deployment', href: '/admin/deployment', heading: 'Deployment' },
      ]) {
        const link = adminNav.getByRole('link', { name: item.label })
        await expect(link).toHaveAttribute('href', item.href)
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${item.href.replace('/', '\\/')}$`))
        await expect(page.getByRole('heading', { name: item.heading })).toBeVisible()
      }
    },
  },
  'admin-application-inventory': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/applications')
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible()
      await expect(page.getByText('Customer portal')).toBeVisible()
      await expect(page.getByText('client-1')).toBeVisible()
      await expect(page.getByText('authorization_code')).toBeVisible()
      await expect(page.getByLabel('Actions for Customer portal')).toBeVisible()
    },
  },
  'admin-create-user': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/admin/users')
      await expect(page.getByText('jane@example.com')).toBeVisible()
      await page.getByRole('button', { name: 'New user' }).click()
      await page.getByLabel('Email').fill('new@example.com')
      await page.getByLabel('Display name').fill('New User')
      await page.getByRole('button', { name: 'Save' }).click()
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/management/users',
        body: { email: 'new@example.com', displayName: 'New User' },
      })
    },
  },
  'admin-user-inventory': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/users')
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
      await page.getByLabel('Search users').fill('jane')
      await expect(page.getByText('Jane Stone')).toBeVisible()
      await expect(page.getByRole('cell', { name: 'admin' })).toBeVisible()
      await expect(page.getByLabel('Actions for jane@example.com')).toBeVisible()
    },
  },
  'admin-create-application': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/admin/applications')
      await expect(page.getByText('Customer portal')).toBeVisible()
      await page.getByRole('button', { name: 'New application' }).click()
      await page.getByLabel('Name').fill('Admin console')
      await page.getByLabel('Slug').fill('admin-console')
      await page.getByLabel('Redirect URIs').fill('http://localhost:4173/oidc/callback')
      await page.getByRole('button', { name: 'Save' }).click()
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/management/applications',
        body: {
          name: 'Admin console',
          slug: 'admin-console',
          clientType: 'public_spa',
          redirectUris: ['http://localhost:4173/oidc/callback'],
        },
      })
    },
  },
  'admin-application-detail': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      applicationDisabled = false
      await page.goto('/admin/applications/app-1')
      await expect(page.getByRole('heading', { name: 'Customer portal' })).toBeVisible()
      await expect(page.getByText('Use these values with any standards-compliant OIDC SDK.')).toBeVisible()
      await expect(page.getByText('https://auth.example.com/api/auth/.well-known/openid-configuration')).toBeVisible()
      await expect(page.getByText('https://auth.example.com/api/auth/oauth2/authorize')).toBeVisible()
      await expect(page.getByText('https://auth.example.com/api/auth/oauth2/token')).toBeVisible()
      await expect(page.getByText('openid profile')).toBeVisible()
      await page.getByLabel('Redirect URIs').fill('https://new.example.com/callback')
      await page.getByRole('button', { name: 'Save redirect URIs' }).click()
      await page.getByRole('button', { name: 'Disable application' }).click()
      await page.getByRole('button', { name: 'Enable application' }).click()
      await page.goto('/admin/applications/confidential-app')
      await expect(page.getByRole('heading', { name: 'Server app' })).toBeVisible()
      await expect(page.getByText('fas_existing')).toBeVisible()
      await page.getByRole('button', { name: 'Rotate client secret' }).click()
      await expect(page.getByText('fas_rotated_secret')).toBeVisible()
      expect(requests).toContainEqual({
        method: 'PUT',
        path: '/api/management/applications/app-1/redirect-uris',
        body: { redirectUris: ['https://new.example.com/callback'] },
      })
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/management/applications/app-1',
        body: { disabled: true, disabledReason: 'Disabled from admin console' },
      })
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/management/applications/app-1',
        body: { disabled: false, disabledReason: null },
      })
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/management/applications/confidential-app/client-secrets',
        body: null,
      })
    },
  },
  'admin-connector-inventory': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/connectors')
      await expect(page.getByRole('heading', { name: 'Connectors' })).toBeVisible()
      await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'github', exact: true })).toBeVisible()
      await expect(page.getByText('read:user, user:email')).toBeVisible()
      await expect(page.getByLabel('Toggle GitHub')).toBeVisible()
    },
  },
  'admin-sign-in-settings': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/sign-in')
      await expect(page.getByRole('heading', { name: 'Sign-in experience' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Authentication methods' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Defaults and links' })).toBeVisible()
      await expect(page.getByText('password enabled')).toBeVisible()
      await expect(page.getByText('social login enabled')).toBeVisible()
      await expect(page.getByText('magic link enabled')).toBeVisible()
      await expect(page.getByText('email otp enabled')).toBeVisible()
      await expect(page.getByText('Default application')).toBeVisible()
      await expect(page.getByText('Default redirect URI')).toBeVisible()
      await expect(page.getByText('Terms')).toBeVisible()
      await expect(page.getByText('Privacy')).toBeVisible()
      await expect(page.getByText('Support email')).toBeVisible()
    },
  },
  'admin-security-policy': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/security')
      await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
      await expect(page.getByText('Multi-factor authentication')).toBeVisible()
      await expect(page.getByText('Mode')).toBeVisible()
      await expect(page.getByText('optional')).toBeVisible()
      await page.getByRole('tab', { name: 'Passkeys' }).click()
      await expect(page.getByText('RP ID')).toBeVisible()
      await expect(page.getByText('localhost')).toBeVisible()
      await expect(page.getByText('RP name')).toBeVisible()
      await expect(page.getByText('Acme ID')).toBeVisible()
      await expect(page.getByText('Origins')).toBeVisible()
      await page.getByRole('tab', { name: 'Sessions' }).click()
      await expect(page.getByRole('heading', { name: 'Session policy' })).toBeVisible()
      await expect(page.getByText('Expires in')).toBeVisible()
      await expect(page.getByText('3600s')).toBeVisible()
      await expect(page.getByText('Fresh age')).toBeVisible()
      await expect(page.getByText('Cookie cache')).toBeVisible()
    },
  },
  'admin-create-connector': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/admin/connectors')
      await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'New connector' }).click()
      await page.getByLabel('Display name').fill('Google')
      await page.getByLabel('Provider ID').fill('google')
      await page.getByLabel('Client ID').fill('google-client')
      await page.getByLabel('Client secret binding').fill('GOOGLE_SECRET')
      await page.getByRole('button', { name: 'Save' }).click()
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/management/connectors',
        body: {
          providerType: 'social',
          providerId: 'google',
          displayName: 'Google',
          clientId: 'google-client',
          clientSecretBinding: 'GOOGLE_SECRET',
        },
      })
    },
  },
  'admin-create-organization': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/organizations')
      await page.getByRole('button', { name: 'New organization' }).click()
      await page.getByLabel('Slug').fill('acme')
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Acme')
      await page.getByLabel('Display name').fill('Acme Inc.')
      await page.getByRole('button', { name: 'Save' }).click()
    },
  },
  'admin-create-role': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/roles')
      await page.getByRole('button', { name: 'New role' }).click()
      await page.getByLabel('Key').fill('support')
      await page.getByLabel('Name').fill('Support')
      await page.getByRole('button', { name: 'Save' }).click()
    },
  },
  'admin-create-api-resource': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/api-resources')
      await page.getByRole('button', { name: 'New resource' }).click()
      await page.getByLabel('Identifier').fill('orders')
      await page.getByLabel('Name').fill('Orders API')
      await page.getByLabel('Audience').fill('https://api.example.com/orders')
      await page.getByRole('button', { name: 'Save' }).click()
    },
  },
  'admin-authorization-inventory': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/organizations')
      await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible()
      await expect(page.getByText('Acme Inc.')).toBeVisible()
      await page.goto('/admin/roles')
      await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible()
      await expect(page.getByRole('row').filter({ hasText: 'Support' }).filter({ hasText: 'support' })).toBeVisible()
      await page.goto('/admin/api-resources')
      await expect(page.getByRole('heading', { name: 'API resources' })).toBeVisible()
      await expect(page.getByText('Orders API')).toBeVisible()
      await expect(page.getByText('https://api.example.com/orders')).toBeVisible()
    },
  },
  'admin-branding-settings': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/branding')
      const main = page.getByRole('main')
      await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible()
      await expect(main.getByText('Brand preview')).toBeVisible()
      await expect(main.getByText('Product name')).toBeVisible()
      await expect(main.getByText('FlareAuth')).toBeVisible()
      await expect(main.getByText('Primary color')).toBeVisible()
      await expect(main.getByText('var(--brand-primary)')).toBeVisible()
      await expect(main.getByText('Custom CSS')).toBeVisible()
      await expect(main.getByText('Configured through configz service')).toBeVisible()
    },
  },
  'admin-deployment-settings': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/admin/deployment')
      const main = page.getByRole('main')
      await expect(page.getByRole('heading', { name: 'Deployment' })).toBeVisible()
      await expect(main.getByText('Runtime')).toBeVisible()
      await expect(main.getByText('Platform')).toBeVisible()
      await expect(main.getByText('Cloudflare Workers')).toBeVisible()
      await expect(main.getByText('Database')).toBeVisible()
      await expect(main.getByText('D1')).toBeVisible()
      await expect(main.getByText('Auth issuer')).toBeVisible()
      await expect(main.getByText('/api/auth')).toBeVisible()
      await expect(main.getByText('Management API')).toBeVisible()
      await expect(main.getByText('/api/management')).toBeVisible()
    },
  },
}

test('declares browser E2E journey coverage above target', () => {
  const declaredIds = journeyCoverage.journeys.map((journey) => journey.id)
  const coveredIds = Object.keys(journeyAssertions)
  const uniqueDeclaredIds = new Set(declaredIds)
  const uniqueCoveredIds = new Set(coveredIds)
  const covered = uniqueCoveredIds.size
  const total = uniqueDeclaredIds.size
  const ratio = covered / total

  console.info(`Browser E2E journey coverage: ${covered}/${total} (${Math.round(ratio * 100)}%)`)

  expect(uniqueDeclaredIds.size).toBe(declaredIds.length)
  expect(uniqueCoveredIds.size).toBe(coveredIds.length)
  expect(coveredIds.every((id) => uniqueDeclaredIds.has(id))).toBe(true)
  expect(declaredIds.every((id) => uniqueCoveredIds.has(id))).toBe(true)
  expect(covered).toBe(total)
  expect(journeyCoverage.waivers).toEqual([])
  expect(ratio).toBeGreaterThanOrEqual(journeyCoverage.target)
  expect(journeyCoverage.honoRpcSmokeJourneys).toEqual(['platform-status'])
})

test('public and auth journeys', async ({ page }) => {
  const requests = await mockApi(page)
  await runJourneySuite('public and auth journeys', { page, requests })
})

test('OAuth consent journey', async ({ page }) => {
  const requests = await mockApi(page)
  await runJourneySuite('OAuth consent journey', { page, requests })
})

test('account center journey', async ({ page }) => {
  const requests = await mockApi(page)
  await mockPasskeys(page)
  await runJourneySuite('account center journey', { page, requests })
})

test('admin management journeys', async ({ page }) => {
  const requests = await mockApi(page)
  await runJourneySuite('admin management journeys', { page, requests })
})

test('admin console desktop and mobile screenshot evidence', async ({ page }, testInfo) => {
  await mockApi(page)

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const route of [
      { name: 'dashboard', path: '/admin', heading: 'Tenant health' },
      { name: 'applications', path: '/admin/applications', heading: 'Applications' },
      { name: 'sign-in-experience', path: '/admin/sign-in', heading: 'Sign-in experience' },
      { name: 'security', path: '/admin/security', heading: 'Security' },
    ]) {
      await page.goto(route.path)
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible()
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`admin-${route.name}-${viewport.name}.png`),
      })
      if (viewport.name === 'mobile' && route.name === 'dashboard') {
        await page.getByRole('button', { name: 'Open admin navigation' }).click()
        await expect(page.getByRole('navigation', { name: 'Admin mobile' })).toBeVisible()
        await expect(page.getByRole('link', { name: /Sign-in experience/ })).toBeVisible()
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath('admin-dashboard-mobile-navigation.png'),
        })
        await page.getByRole('button', { name: 'Close admin navigation' }).click()
      }
    }
  }
})

type JourneyAssertionSuite = (typeof journeyAssertions)[JourneyId]['suite']

async function runJourneySuite(suite: JourneyAssertionSuite, context: JourneyContext) {
  for (const [id, journey] of Object.entries(journeyAssertions)) {
    if (journey.suite === suite) {
      await test.step(id, () => journey.assert(context))
    }
  }
}

async function mockApi(page: Page) {
  const requests: RequestRecord[] = []

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = request.postDataJSON() ?? null

    if (!path.startsWith('/api/')) {
      await route.continue()
      return
    }

    if (method !== 'GET') requests.push({ method, path, body })

    if (path === '/api/auth/oauth2/authorize') {
      await route.fulfill({
        status: 302,
        headers: { location: `/oidc/callback?code=demo-code&state=${url.searchParams.get('state') ?? ''}` },
      })
      return
    }

    if (!accountSignedIn && path.startsWith('/api/account/')) {
      await fulfill(route, { error: 'Authentication is required.' }, 401)
      return
    }

    await fulfill(route, await responseFor(path, method, body))
  })

  return requests
}

async function mockPasskeys(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: {
        create: async () => ({
          id: 'credential-1',
          rawId: Uint8Array.from([1, 2, 3]).buffer,
          response: {
            attestationObject: Uint8Array.from([4, 5, 6]).buffer,
            clientDataJSON: Uint8Array.from([7, 8, 9]).buffer,
            getTransports: () => ['internal'],
          },
          type: 'public-key',
          getClientExtensionResults: () => ({}),
        }),
      },
    })
  })
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function responseFor(path: string, method: string, body: unknown): Promise<unknown> {
  if (path === '/api/health') {
    const response = await createApp(createAuthMock()).request('/api/health', { method })
    return response.json()
  }
  if (path === '/api/configz') {
    return {
      ...configz,
      onboarding: { required: firstAdminRequired, href: '/onboarding' },
      signIn: { ...configz.signIn, identifierFirst: identifierFirstRequired },
    }
  }
  if (path === '/api/onboarding/status') return { required: firstAdminRequired }
  if (path === '/api/onboarding/admin-users') {
    return {
      user: { id: 'user-admin', email: 'admin@example.com', role: 'admin' },
      onboarding: { locked: true },
    }
  }
  if (path === '/api/oauth/consent' && method === 'GET') return consentResponse
  if (path === '/api/management/sign-in-settings') {
    return {
      signIn: configz.signIn,
      defaults: configz.defaults,
      links: configz.links,
    }
  }
  if (path === '/api/management/readiness') {
    return {
      admin: {
        setupRequired: adminSetupRequired,
        setupHref: '/admin/onboarding',
        missing: adminSetupRequired ? ['oidc_application'] : [],
      },
    }
  }
  if (path === '/api/management/security/policy') return { policy: securityPolicy }
  if (path === '/api/management/applications') {
    if (method === 'POST') return application
    return { applications: [application], pagination }
  }
  if (path === '/api/management/applications/app-1') {
    if (method === 'PATCH') {
      applicationDisabled =
        typeof body === 'object' && body !== null && 'disabled' in body && typeof body.disabled === 'boolean'
          ? body.disabled
          : applicationDisabled
      return { ...application, disabled: applicationDisabled }
    }
    if (method === 'DELETE') return null
    return { ...application, disabled: applicationDisabled }
  }
  if (path === '/api/management/applications/app-1/redirect-uris') {
    if (method === 'PUT') return { redirectUris: ['https://new.example.com/callback'] }
    return { redirectUris: application.redirectUris, pagination }
  }
  if (path === '/api/management/applications/app-1/client-secrets') {
    return { secrets: [], pagination: emptyPagination }
  }
  if (path === '/api/management/applications/confidential-app') {
    return confidentialApplication
  }
  if (path === '/api/management/applications/confidential-app/client-secrets') {
    if (method === 'POST') {
      return {
        clientSecret: 'fas_rotated_secret',
        secret: {
          id: 'secret-2',
          version: 2,
          prefix: 'fas_rotated',
          status: 'active',
          createdAt: '2026-01-02T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
        },
      }
    }
    return { secrets: confidentialApplication.secretMetadata, pagination }
  }
  if (path === '/api/management/users') {
    if (method === 'POST') return user
    return { users: [user], pagination }
  }
  if (path === '/api/management/connectors') {
    if (method === 'POST') return connector
    return { connectors: [connector], pagination }
  }
  if (path === '/api/management/organizations') {
    if (method === 'POST') return organization
    return { organizations: [organization], pagination }
  }
  if (path === '/api/management/roles') {
    if (method === 'POST') return role
    return { roles: [role], pagination }
  }
  if (path === '/api/management/api-resources') {
    if (method === 'POST') return apiResource
    return { resources: [apiResource], pagination }
  }
  if (path === '/api/account/profile') return { user: profile }
  if (path === '/api/account/linked-accounts') return { accounts: [linkedAccount] }
  if (path === '/api/account/applications') return { applications: [] }
  if (path === '/api/account/sessions') return { sessions: [session] }
  if (path === '/api/account/security') return { security: securityState }
  if (path === '/api/account/security/mfa/totp-enrollment') return totpEnrollment
  if (path === '/api/account/security/passkeys') return { passkeys: [] }
  if (path === '/api/account/security/passkeys/registration-options') return passkeyRegistrationOptions
  return { ok: true }
}

function createAuthMock() {
  return {
    api: {
      getOAuthServerConfig: async () => ({}),
      getOpenIdConfig: async () => ({}),
      getSession: async () => null,
    },
    handler: async () => new Response(null, { status: 204 }),
  }
}

const pagination = {
  limit: 50,
  offset: 0,
  total: 1,
  hasMore: false,
  nextOffset: null,
}

const emptyPagination = {
  ...pagination,
  total: 0,
}

const configz = {
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
    logoUrl: null,
    faviconUrl: null,
    primaryColor: '#b42318',
    backgroundColor: '#f7f3ee',
    customCss: null,
  },
  identityProviders: [],
  links: {
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
  },
  copy: {
    productName: 'Acme ID',
    headline: 'Sign in to Acme.',
    description: 'Hosted identity for Acme apps.',
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
    userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  },
  security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
}

const application = {
  id: 'app-1',
  slug: 'customer-portal',
  name: 'Customer portal',
  description: null,
  homepageUrl: null,
  iconUrl: null,
  clientId: 'client-1',
  clientType: 'public_spa',
  public: true,
  firstParty: true,
  trusted: true,
  disabled: false,
  disabledReason: null,
  redirectUris: ['http://localhost:4173/oidc/callback'],
  allowedGrantTypes: ['authorization_code'],
  allowedScopes: ['openid', 'profile'],
  requirePkce: true,
  tokenEndpointAuthMethod: 'none',
  secretMetadata: [],
  oidc: {
    issuer: 'https://auth.example.com/api/auth',
    authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
    tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
    jwksUri: 'https://auth.example.com/api/auth/jwks',
    userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const confidentialApplication = {
  ...application,
  id: 'confidential-app',
  slug: 'server-app',
  name: 'Server app',
  clientId: 'server-client',
  clientType: 'confidential_web',
  public: false,
  requirePkce: false,
  tokenEndpointAuthMethod: 'client_secret_basic',
  secretMetadata: [
    {
      id: 'secret-1',
      version: 1,
      prefix: 'fas_existing',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
    },
  ],
}

const consentResponse = {
  application,
  user: {
    email: 'jane@example.com',
    displayName: 'Jane Stone',
    image: null,
  },
  redirects: {
    approveUrl:
      '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foidc%2Fcallback&response_type=code&scope=openid+profile&state=state-1&code_challenge=challenge-1&code_challenge_method=S256&nonce=nonce-1',
    denyUrl: 'http://127.0.0.1:5173/oidc/callback?error=access_denied&state=state-1',
  },
  requestedScopes: ['openid', 'profile'],
  existingConsent: null,
  state: 'state-1',
}

const connector = {
  id: 'connector-1',
  providerId: 'github',
  providerType: 'social',
  displayName: 'GitHub',
  enabled: true,
  clientId: 'github-client',
  clientSecretBinding: 'GITHUB_SECRET',
  scopes: ['read:user', 'user:email'],
  iconUrl: null,
  authorizationUrl: null,
  tokenUrl: null,
  userInfoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const user = {
  id: 'user-1',
  email: 'jane@example.com',
  name: 'Jane Stone',
  role: 'admin',
  banned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const profile = {
  ...user,
  emailVerified: true,
  displayName: 'Jane Stone',
  username: 'jane',
  avatarAssetId: null,
  image: null,
}

const linkedAccount = {
  id: 'linked-account-1',
  providerId: 'github',
  accountId: 'github-jane',
  displayName: 'GitHub',
  email: 'jane@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const session = {
  id: 'session-1',
  expiresAt: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ipAddress: '127.0.0.1',
  userAgent: 'Playwright',
}

const securityPolicy = {
  mfa: { mode: 'optional' },
  passkeys: { enabled: true, rpId: 'localhost', rpName: 'Acme ID', origins: ['http://127.0.0.1:5173'] },
  sessions: { expiresInSeconds: 3600, updateAgeSeconds: 300, freshAgeSeconds: 300, cookieCacheSeconds: 60 },
}

const securityState = {
  mfa: { enabled: false, factors: [] },
  passkeys: { enabled: true, count: 0 },
  policy: securityPolicy,
}

const totpEnrollment = {
  totpURI: 'otpauth://totp/Acme:jane@example.com?secret=ABC123&issuer=Acme',
  qrCode: 'data:image/png;base64,AAAA',
  secret: 'ABC123',
}

const passkeyRegistrationOptions = {
  challenge: 'AQID',
  rp: { name: 'Acme ID', id: 'localhost' },
  user: { id: 'BAUG', name: 'jane@example.com', displayName: 'Jane Stone' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  timeout: 60000,
  attestation: 'none',
  authenticatorSelection: {
    residentKey: 'preferred',
    userVerification: 'preferred',
  },
  excludeCredentials: [],
}

const organization = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme',
  displayName: 'Acme Inc.',
  description: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const role = {
  id: 'role-1',
  key: 'support',
  name: 'Support',
  description: null,
  permissions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const apiResource = {
  id: 'resource-1',
  identifier: 'orders',
  name: 'Orders API',
  audience: 'https://api.example.com/orders',
  description: null,
  scopes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

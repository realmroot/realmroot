import { expect, test, type Page, type Request, type Route } from '@playwright/test'
import { Buffer } from 'node:buffer'
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

const accountSections = [
  'Profile',
  'Identifiers',
  'Password',
  'MFA',
  'Passkeys',
  'Linked social accounts',
  'Sessions and devices',
  'Authorized apps',
] as const

const hostedAuthRoutes = [
  { name: 'hosted-sign-in', path: '/sign-in', heading: /Sign in to/ },
  { name: 'hosted-sign-up', path: '/sign-up', heading: 'Start with your identity.' },
  { name: 'hosted-recovery', path: '/forgot-password', heading: 'Recover your password.' },
  { name: 'hosted-email-verification', path: '/email-verification', heading: 'Verify your email.' },
  {
    name: 'hosted-callback-error',
    path: '/auth/callback?error=access_denied&error_description=Denied',
    heading: 'Sign-in could not continue.',
    compactAuth: true,
  },
  {
    name: 'oauth-consent',
    path: '/oauth/consent?client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foidc%2Fcallback&response_type=code&scope=openid%20profile&state=state-1',
    heading: 'Review application access.',
  },
] as const

const accountRoutes = [
  { name: 'account-home', path: '/account', heading: 'Jane Stone' },
  { name: 'account-profile', path: '/account/profile', heading: 'Jane Stone' },
  { name: 'account-security', path: '/account/security', heading: 'MFA' },
  { name: 'account-linked-accounts', path: '/account/linked-accounts', heading: 'Linked social accounts' },
  { name: 'account-sessions', path: '/account/sessions', heading: 'Sessions and devices' },
  { name: 'account-authorized-apps', path: '/account/authorized-apps', heading: 'Authorized apps' },
] as const

const consoleRoutes = [
  {
    name: 'dashboard',
    path: '/console',
    heading: 'Tenant health',
    kind: 'shell',
    journeyId: 'admin-dashboard',
    sentinel: 'Setup progress',
    activeNav: 'Dashboard',
  },
  {
    name: 'applications',
    path: '/console/applications',
    heading: 'Applications',
    kind: 'list',
    journeyId: 'admin-application-inventory',
    sentinel: 'client-1',
    activeNav: 'Applications',
  },
  {
    name: 'application-detail',
    path: '/console/applications/app-1',
    heading: 'Customer portal',
    kind: 'detail',
    journeyId: 'admin-application-detail',
    sentinel: 'Use these values with any standards-compliant OIDC SDK.',
    activeNav: 'Applications',
  },
  {
    name: 'sign-in-experience',
    path: '/console/sign-in-experience/sign-up-and-sign-in',
    heading: 'Sign-up and sign-in',
    kind: 'settings',
    journeyId: 'admin-sign-in-settings',
    sentinel: 'Sign-in methods',
    activeNav: 'Sign-in & account',
  },
  {
    name: 'branding',
    path: '/console/sign-in-experience/branding',
    heading: 'Branding',
    kind: 'settings',
    journeyId: 'admin-branding-settings',
    sentinel: 'Hosted sign-in preview',
    activeNav: 'Sign-in & account',
  },
  {
    name: 'collect-profile',
    path: '/console/sign-in-experience/collect-user-profile',
    heading: 'Collect user profile',
    kind: 'settings',
    journeyId: 'admin-sign-in-experience-routes',
    sentinel: 'Custom profile fields',
    activeNav: 'Sign-in & account',
  },
  {
    name: 'account-center-settings',
    path: '/console/sign-in-experience/account-center',
    heading: 'Account Center',
    kind: 'settings',
    journeyId: 'admin-sign-in-experience-routes',
    sentinel: 'Account field permissions',
    activeNav: 'Sign-in & account',
  },
  {
    name: 'content-settings',
    path: '/console/sign-in-experience/content',
    heading: 'Content',
    kind: 'settings',
    journeyId: 'admin-sign-in-experience-routes',
    sentinel: 'Language and messages',
    activeNav: 'Sign-in & account',
  },
  {
    name: 'mfa',
    path: '/console/mfa',
    heading: 'Multi-factor auth',
    kind: 'settings',
    journeyId: 'admin-security-policy',
    sentinel: 'Policy controls',
    activeNav: 'Multi-factor auth',
  },
  {
    name: 'connectors',
    path: '/console/connectors/passwordless',
    heading: 'Passwordless connectors',
    kind: 'list',
    journeyId: 'admin-connector-inventory',
    sentinel: 'Email connector',
    activeNav: 'Connectors',
  },
  {
    name: 'social-connectors',
    path: '/console/connectors/social',
    heading: 'Social connectors',
    kind: 'list',
    journeyId: 'admin-social-connector-inventory',
    sentinel: 'GitHub',
    activeNav: 'Connectors',
  },
  {
    name: 'security',
    path: '/console/security/password-policy',
    heading: 'Security',
    kind: 'settings',
    journeyId: 'admin-security-policy',
    sentinel: 'Password policy',
    activeNav: 'Security',
  },
  {
    name: 'security-captcha',
    path: '/console/security/captcha',
    heading: 'CAPTCHA',
    kind: 'settings',
    journeyId: 'admin-security-policy',
    sentinel: 'Provider setup',
    activeNav: 'Security',
  },
  {
    name: 'security-blocklist',
    path: '/console/security/blocklist',
    heading: 'Blocklist',
    kind: 'settings',
    journeyId: 'admin-security-policy',
    sentinel: 'Email blocklist',
    activeNav: 'Security',
  },
  {
    name: 'security-general',
    path: '/console/security/general',
    heading: 'General security',
    kind: 'settings',
    journeyId: 'admin-security-policy',
    sentinel: 'MFA enforcement',
    activeNav: 'Security',
  },
  {
    name: 'api-resources',
    path: '/console/api-resources',
    heading: 'API resources',
    kind: 'list',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Orders API',
    activeNav: 'API resources',
  },
  {
    name: 'api-resource-detail',
    path: '/console/api-resources/resource-1',
    heading: 'Orders API',
    kind: 'detail',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Scopes',
    activeNav: 'API resources',
  },
  {
    name: 'roles',
    path: '/console/roles',
    heading: 'Roles',
    kind: 'list',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'support',
    activeNav: 'Roles',
  },
  {
    name: 'role-detail',
    path: '/console/roles/role-1/permissions',
    heading: 'Support',
    kind: 'detail',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Permission assignment',
    activeNav: 'Roles',
  },
  {
    name: 'organization-template',
    path: '/console/organization-template/organization-roles',
    heading: 'Organization template',
    kind: 'settings',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Organization permissions',
    activeNav: 'Organization template',
  },
  {
    name: 'organizations',
    path: '/console/organizations',
    heading: 'Organizations',
    kind: 'list',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Acme Inc.',
    activeNav: 'Organizations',
  },
  {
    name: 'organization-detail',
    path: '/console/organizations/org-1',
    heading: 'Acme',
    kind: 'detail',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Authorization model',
    activeNav: 'Organizations',
  },
  {
    name: 'users',
    path: '/console/users',
    heading: 'Users',
    kind: 'list',
    journeyId: 'admin-user-inventory',
    sentinel: 'jane@example.com',
    activeNav: 'User management',
  },
  {
    name: 'user-detail',
    path: '/console/users/user-1/security',
    heading: 'Jane Stone',
    kind: 'detail',
    journeyId: 'admin-user-detail',
    sentinel: 'MFA and passkeys',
    activeNav: 'User management',
  },
  {
    name: 'custom-jwt',
    path: '/console/customize-jwt',
    heading: 'Custom JWT',
    kind: 'settings',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Access token',
    activeNav: 'Custom JWT',
  },
  {
    name: 'webhooks',
    path: '/console/webhooks',
    heading: 'Webhooks',
    kind: 'settings',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'Webhook delivery unavailable',
    activeNav: 'Webhooks',
  },
  {
    name: 'audit-logs',
    path: '/console/audit-logs',
    heading: 'Audit logs',
    kind: 'list',
    journeyId: 'admin-authorization-inventory',
    sentinel: 'No audit events to display',
    activeNav: null,
  },
  {
    name: 'tenant-settings',
    path: '/console/tenant-settings/oidc-configs',
    heading: 'OIDC configs',
    kind: 'settings',
    journeyId: 'admin-deployment-settings',
    sentinel: 'Runtime endpoints',
    activeNav: 'Settings',
  },
  {
    name: 'console-onboarding',
    path: '/console/onboarding',
    heading: 'Console setup',
    kind: 'settings',
    journeyId: 'admin-onboarding',
    sentinel: 'First OIDC application',
    activeNav: null,
    setupRequired: true,
  },
] as const

let firstAdminRequired = false
let adminSetupRequired = false
let accountSignedIn = true
let accountApplicationRevoked = false
let applicationDisabled = false
let adminUserBanned = false
let identifierFirstRequired = false
let accountMfaEnabled = false
let consentSessionAvailable = true

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
        await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password-1')
        await page.getByRole('button', { name: 'Create first admin' }).click()
        await expect(page.getByText('First admin created.')).toBeVisible()
        await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveCount(0)
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
      await expect(page.getByRole('button', { name: 'Password', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'OTP' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
    },
  },
  'oidc-hosted-sign-in-context': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback')
      await expect(page.getByRole('heading', { name: /^(Continue to client\.example\.com\.|Sign in to Acme\.)$/ })).toBeVisible()
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
        const continueButton = page.getByRole('button', { name: 'Continue' })
        if ((await continueButton.count()) > 0) {
          await continueButton.click()
          await expect(page.getByText('Signing in as')).toBeVisible()
        }
        await page.getByRole('button', { name: 'OTP' }).click()
        await page.getByRole('button', { name: 'Send code' }).click()
        expect(requests).toContainEqual({
          method: 'POST',
          path: '/api/auth/email-otp/send-verification-otp',
          body: { email: 'jane@example.com', type: 'sign-in' },
        })
        if ((await page.getByRole('button', { name: 'Change' }).count()) > 0) {
          await page.getByRole('button', { name: 'Change' }).click()
          await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
        }
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
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password-1')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/account$/)
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/auth/sign-in/email',
        body: { email: 'jane@example.com', password: 'password-1', rememberMe: true },
      })
    },
  },
  'normal-signup-signin-account': {
    suite: 'public and auth journeys',
    assert: async ({ page, requests }) => {
      accountSignedIn = false
      try {
        await page.goto('/sign-up')
        await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Jane Stone')
        await page.getByLabel('Email').fill('jane@example.com')
        await page.getByLabel('Username').fill('jane')
        await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password-1')
        await page.getByRole('button', { name: 'Create account' }).click()
        await expect(page.getByText('Account created. Check your email if verification is required.')).toBeVisible()

        await page.goto('/sign-in')
        await page.getByLabel('Email or username').fill('jane@example.com')
        await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password-1')
        await page.getByRole('button', { name: 'Sign in' }).click()

        await expect(page).toHaveURL(/\/account$/)
        await expect(page.getByRole('heading', { name: 'Jane Stone' })).toBeVisible()
        await expectAccountSinglePageSections(page)
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
        expect(requests).toContainEqual({
          method: 'POST',
          path: '/api/auth/sign-in/email',
          body: { email: 'jane@example.com', password: 'password-1', rememberMe: true },
        })
      } finally {
        accountSignedIn = true
      }
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
      await page.getByRole('textbox', { name: 'New password', exact: true }).fill('new-password')
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
  'hosted-auth-error-flow': {
    suite: 'public and auth journeys',
    assert: async ({ page }) => {
      await page.goto('/auth/callback?error=access_denied&error_description=Denied')
      await expect(page.getByRole('heading', { name: 'Sign-in could not continue.' })).toBeVisible()
      await expect(page.getByText('Denied')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/sign-in')

      consentSessionAvailable = false
      try {
        await page.goto(
          '/oauth/consent?client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foidc%2Fcallback&state=state-1',
        )
        await expect(page.getByRole('heading', { name: 'Review application access.' })).toBeVisible()
        await expect(page.getByText('Authentication is required.')).toBeVisible()
        await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute(
          'href',
          /\/sign-in\?client_id=client-1&redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A5173%2Foidc%2Fcallback&state=state-1/,
        )
      } finally {
        consentSessionAvailable = true
      }
    },
  },
  'sign-up': {
    suite: 'public and auth journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/sign-up')
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Jane Stone')
      await page.getByLabel('Email').fill('jane@example.com')
      await page.getByLabel('Username').fill('jane')
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password-1')
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
      await page.getByRole('button', { name: 'Approve access' }).click()
      await expect(page).toHaveURL(/\/oidc\/callback\?code=auth-code&state=state-1/)
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
      await expect(page.getByRole('link', { name: 'Deny' })).toHaveAttribute(
        'href',
        /\/oidc\/callback\?error=access_denied&state=state-1/,
      )
    },
  },
  'oidc-client-callback': {
    suite: 'OAuth consent journey',
    assert: async ({ page }) => {
      const oidcPage = await page.context().newPage()
      await mockApi(oidcPage)
      try {
        await oidcPage.goto('/oidc/start?client_id=client-1&redirect_uri=http%3A%2F%2Flocalhost%3A4173%2Foidc%2Fcallback')
        await expect(oidcPage.getByRole('heading', { name: 'Client callback' })).toBeVisible()
        await expect(oidcPage.getByText(/code=auth-code&state=/)).toBeVisible()
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
      await expect(page).toHaveURL(/\/account$/)
      await expectAccountSinglePageSections(page)
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    },
  },
  'account-deep-links': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      for (const path of [
        '/account/profile',
        '/account/security',
        '/account/linked-accounts',
        '/account/sessions',
        '/account/authorized-apps',
      ]) {
        await page.goto(path)
        await expect(page).toHaveURL(/\/account$/)
        await expect(page.getByRole('heading', { name: 'Jane Stone' })).toBeVisible()
        await expectAccountSinglePageSections(page)
      }
    },
  },
  'profile-update': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account')
      await page.getByLabel('Display name').fill('Jane Q. Stone')
      await page.getByRole('button', { name: 'Save profile' }).click()
      await expect.poll(() => requests).toContainEqual({
        method: 'PATCH',
        path: '/api/account/profile',
        body: { displayName: 'Jane Q. Stone', username: 'jane', avatarAssetId: null },
      })
    },
  },
  'profile-avatar-upload': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account')
      await page.locator('input[type="file"]').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      })
      await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Profile' }) }).locator('img')).toBeVisible()
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/account/avatar',
        body: '[form-data]',
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
      await page.getByRole('textbox', { name: 'Current password', exact: true }).fill('password-1')
      await page.getByRole('textbox', { name: 'New password', exact: true }).fill('new-password')
      await page.getByRole('button', { name: 'Change password' }).click()
    },
  },
  'totp-flow': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account/security')
      const mfaSection = page.locator('.settingsPanel', { has: page.getByRole('heading', { name: 'MFA' }) })
      await mfaSection.getByRole('textbox', { name: 'Password', exact: true }).fill('password-1')
      await page.getByRole('button', { name: 'Enroll authenticator app' }).click()
      await expect(page.getByText('Authenticator setup')).toBeVisible()
      await page.getByLabel('Authenticator code').fill('123456')
      await page.getByRole('button', { name: 'Verify code' }).click()
      await expect(mfaSection.getByText('Enabled')).toBeVisible()
      await mfaSection.getByRole('textbox', { name: 'Password', exact: true }).fill('password-1')
      await page.getByRole('button', { name: 'Disable MFA' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('button', { name: 'Disable MFA' }).click()
      await page.getByRole('button', { name: 'Disable authenticator app' }).click()
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/account/security/mfa/totp',
        body: { password: 'password-1' },
      })
    },
  },
  'passkey-flow': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account/security')
      await page.getByLabel('Passkey name').fill('MacBook Touch ID')
      await page.getByRole('button', { name: 'Add passkey' }).click()
      await page.getByRole('button', { name: 'Remove' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('button', { name: 'Remove' }).click()
      await page.getByRole('button', { name: 'Remove passkey' }).click()
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/account/security/passkeys/passkey-1',
        body: null,
      })
    },
  },
  'linked-account-unlink': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account/linked-accounts')
      await page.getByRole('button', { name: 'Unlink' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('button', { name: 'Unlink' }).click()
      await page.getByRole('button', { name: 'Unlink account' }).click()
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/account/linked-accounts/github',
        body: null,
      })
    },
  },
  'session-revocation': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      await page.goto('/account/sessions')
      await page.getByRole('button', { name: 'Revoke other sessions' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('button', { name: 'Revoke other sessions' }).click()
      await page.getByRole('button', { name: 'Revoke sessions' }).click()
      await page
        .locator('.settingsPanel', { has: page.getByRole('heading', { name: 'Sessions and devices' }) })
        .getByRole('button', { name: 'Revoke', exact: true })
        .click()
      await page.getByRole('button', { name: 'Revoke session' }).click()
      expect(requests).toContainEqual({ method: 'DELETE', path: '/api/account/security/sessions', body: null })
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/account/security/sessions/session-1',
        body: null,
      })
    },
  },
  'authorized-app-revoke': {
    suite: 'account center journey',
    assert: async ({ page, requests }) => {
      accountApplicationRevoked = false
      await page.goto('/account/authorized-apps')
      await expect(page.getByText('Customer portal')).toBeVisible()
      await page
        .locator('.settingsPanel', { has: page.getByRole('heading', { name: 'Authorized apps' }) })
        .getByRole('button', { name: 'Revoke' })
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page
        .locator('.settingsPanel', { has: page.getByRole('heading', { name: 'Authorized apps' }) })
        .getByRole('button', { name: 'Revoke' })
        .click()
      await page.getByRole('button', { name: 'Revoke access' }).click()
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/account/applications/consent-1',
        body: null,
      })
      await expect(page.getByText('No application consents.')).toBeVisible()
    },
  },
  'sign-out': {
    suite: 'account center journey',
    assert: async ({ page }) => {
      const accountUnauthorizedResponses: string[] = []
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname
        if (path.startsWith('/api/account/') && response.status() === 401) accountUnauthorizedResponses.push(path)
      })

      await page.goto('/account')
      await expect(page.getByRole('heading', { name: 'Jane Stone' })).toBeVisible()
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(page).toHaveURL(/\/sign-in$/)
      await expect(page.getByRole('heading', { name: 'Sign in to Acme.' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Jane Stone' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'MFA' })).toHaveCount(0)
      expect(accountUnauthorizedResponses).toEqual([])
    },
  },
  'admin-signed-out-redirect': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      const managementRequests: string[] = []
      const managementAuthFailures: string[] = []
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname
        if (path.startsWith('/api/management/')) managementRequests.push(path)
      })
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname
        if (path.startsWith('/api/management/') && (response.status() === 401 || response.status() === 403)) {
          managementAuthFailures.push(path)
        }
      })

      accountSignedIn = false
      try {
        await page.goto('/console')
        await expect(page).toHaveURL(/\/sign-in\?return_to=%2Fconsole$/)
        await expect(page.getByRole('heading', { name: 'Sign in to Acme.' })).toBeVisible()
        expect(managementRequests).toEqual([])
        expect(managementAuthFailures).toEqual([])
      } finally {
        accountSignedIn = true
      }
    },
  },
  'admin-dashboard': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console')
      await expect(page.getByRole('heading', { name: 'Tenant health' })).toBeVisible()
      await page.goto('/console/onboarding')
      await expect(page).toHaveURL(/\/console$/)
      await expect(page.getByRole('heading', { name: 'Tenant health' })).toBeVisible()
    },
  },
  'admin-setup-gate': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      adminSetupRequired = true
      try {
        await page.goto('/console/applications')
        await expect(page).toHaveURL(/\/console\/onboarding$/)
        await expect(page.getByRole('heading', { name: 'Console setup' })).toBeVisible()
        await expect(page.getByText('Setup checklist')).toBeVisible()
        await expect(page.getByText('Create an OIDC application')).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Console' }).getByText('Onboarding')).toHaveCount(0)
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
        await page.goto('/console/onboarding')
        await expect(page.getByRole('heading', { name: 'Console setup' })).toBeVisible()
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
            firstParty: true,
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
      await page.goto('/console')
      const consoleNav = page.getByRole('navigation', { name: 'Console' })
      await expect(consoleNav.getByText('Onboarding')).toHaveCount(0)
      await expect(consoleNav.getByRole('link', { name: 'Audit logs' })).toHaveCount(0)

      for (const item of [
        { label: 'Dashboard', href: '/console', heading: 'Tenant health' },
        { label: 'Applications', href: '/console/applications', heading: 'Applications' },
        {
          label: 'Sign-in & account',
          href: '/console/sign-in-experience/sign-up-and-sign-in',
          heading: 'Sign-up and sign-in',
        },
        { label: 'Multi-factor auth', href: '/console/mfa', heading: 'Multi-factor auth' },
        { label: 'Connectors', href: '/console/connectors/passwordless', heading: 'Passwordless connectors' },
        { label: 'Security', href: '/console/security/password-policy', heading: 'Security' },
        { label: 'API resources', href: '/console/api-resources', heading: 'API resources' },
        { label: 'Roles', href: '/console/roles', heading: 'Roles' },
        {
          label: 'Organization template',
          href: '/console/organization-template/organization-roles',
          heading: 'Organization roles',
        },
        { label: 'Organizations', href: '/console/organizations', heading: 'Organizations' },
        { label: 'User management', href: '/console/users', heading: 'Users' },
        { label: 'Custom JWT', href: '/console/customize-jwt', heading: 'Custom JWT' },
        { label: 'Webhooks', href: '/console/webhooks/endpoints', heading: 'Webhooks' },
        { label: 'Settings', href: '/console/tenant-settings/oidc-configs', heading: 'OIDC configs' },
      ]) {
        const link = consoleNav.locator(`a[href="${item.href}"]`)
        await expect(link).toContainText(item.label)
        await expect(link).toHaveAttribute('href', item.href)
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${(item.expectedUrl ?? item.href).replace('/', '\\/')}$`))
        await expect(page.getByRole('heading', { name: item.heading }).first()).toBeVisible()
      }
    },
  },
  'admin-application-inventory': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console/applications')
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Customer portal' })).toBeVisible()
      await expect(page.getByText('client-1')).toBeVisible()
      await expect(page.getByText('authorization_code')).toBeVisible()
      await expect(page.getByLabel('Actions for Customer portal')).toBeVisible()
    },
  },
  'admin-create-user': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/console/users')
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
      await page.goto('/console/users')
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
      await page.getByLabel('Search users').fill('jane')
      await expect(page.getByText('Jane Stone')).toBeVisible()
      await expect(page.getByRole('cell', { name: 'admin' })).toBeVisible()
      await expect(page.getByLabel('Actions for jane@example.com')).toBeVisible()
    },
  },
  'admin-user-detail': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      adminUserBanned = false
      await page.goto('/console/users')
      await page.getByRole('link', { name: 'Jane Stone' }).click()
      await expect(page).toHaveURL(/\/console\/users\/user-1\/profile$/)
      await expect(page.getByRole('heading', { name: 'Jane Stone' })).toBeVisible()
      await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: 'Security' }).click()
      await expect(page.getByText('MFA and passkeys')).toBeVisible()
      await page.getByRole('tab', { name: 'Linked accounts' }).click()
      await expect(page.getByText('github-jane')).toBeVisible()
      await page.getByRole('tab', { name: 'Applications' }).click()
      await expect(page.getByText('Customer portal')).toBeVisible()
      await page.getByRole('tab', { name: 'Profile' }).click()
      await expect(page).toHaveURL(/\/console\/users\/user-1\/profile$/)
      await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
      const profileForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save profile' }) })
      await expect(profileForm.getByLabel('Display name', { exact: true })).toHaveValue('Jane Stone')
      await page.waitForTimeout(100)
      await profileForm.getByLabel('Display name', { exact: true }).evaluate((input) => {
        const displayName = input as HTMLInputElement
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        valueSetter?.call(displayName, 'Jane Q. Stone')
        displayName.dispatchEvent(new Event('input', { bubbles: true }))
        displayName.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await expect(profileForm.getByLabel('Display name', { exact: true })).toHaveValue('Jane Q. Stone')
      await profileForm.getByLabel('Role').selectOption('user')
      await profileForm.getByLabel('Email verification').selectOption('false')
      await profileForm.getByRole('button', { name: 'Save profile' }).click()
      await page.getByRole('tab', { name: 'Operations' }).click()
      await page.getByRole('button', { name: 'Send password reset' }).click()
      await page.getByRole('tab', { name: 'Sessions' }).click()
      await page.getByRole('button', { name: 'Revoke', exact: true }).click()
      await page.getByRole('button', { name: 'Revoke session' }).click()
      await page.getByRole('button', { name: 'Revoke all' }).click()
      await page.getByRole('button', { name: 'Revoke sessions' }).click()
      await page.getByRole('tab', { name: 'Security' }).click()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('button', { name: 'Delete passkey' }).click()
      await page.getByRole('tab', { name: 'Operations' }).click()
      await page.getByRole('button', { name: 'Ban user' }).click()
      await page.getByLabel('Reason').fill('abuse')
      await page.getByRole('dialog').getByRole('button', { name: 'Ban user' }).click()
      await expect(page.getByRole('button', { name: 'Unban user' })).toBeVisible()
      await page.getByRole('button', { name: 'Unban user' }).click()
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/management/users/user-1',
        body: {
          email: 'jane@example.com',
          displayName: 'Jane Q. Stone',
          username: 'jane',
          role: 'user',
          emailVerified: false,
        },
      })
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/management/users/user-1/password-reset-requests',
        body: {},
      })
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/management/users/user-1/sessions/session-1',
        body: null,
      })
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/management/users/user-1/sessions',
        body: null,
      })
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/management/users/user-1/passkeys/passkey-1',
        body: null,
      })
      expect(requests).toContainEqual({
        method: 'PUT',
        path: '/api/management/users/user-1/ban',
        body: { reason: 'abuse' },
      })
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/management/users/user-1/ban',
        body: null,
      })
    },
  },
  'admin-create-application': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/console/applications')
      await expect(page.getByRole('link', { name: 'Customer portal' })).toBeVisible()
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
            firstParty: true,
            redirectUris: ['http://localhost:4173/oidc/callback'],
          },
      })
    },
  },
  'admin-application-detail': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      applicationDisabled = false
      await page.goto('/console/applications/app-1')
      await expect(page).toHaveURL(/\/console\/applications\/app-1\/settings$/)
      await expect(page.getByRole('heading', { name: 'Customer portal' })).toBeVisible()
      await expect(page.getByText('Use these values with any standards-compliant OIDC SDK.')).toBeVisible()
      await expect(page.getByText('https://auth.example.com/api/auth/.well-known/openid-configuration')).toBeVisible()
      await expect(page.getByText('https://auth.example.com/api/auth/oauth2/authorize')).toBeVisible()
      await expect(page.getByText('https://auth.example.com/api/auth/oauth2/token')).toBeVisible()
      await expect(page.getByText('openid profile')).toBeVisible()
      await page.getByRole('tab', { name: 'Branding' }).click()
      await expect(page).toHaveURL(/\/console\/applications\/app-1\/branding$/)
      const applicationLogoInput = page.locator('input[type="file"][aria-label="Upload logo for Customer portal"]')
      await expect(applicationLogoInput).toBeVisible()
      await page.getByRole('tab', { name: 'Settings' }).click()
      await expect(page).toHaveURL(/\/console\/applications\/app-1\/settings$/)
      const redirectUrisInput = page.getByRole('textbox', { name: 'Redirect URIs', exact: true })
      await expect(redirectUrisInput).toHaveValue('http://localhost:4173/oidc/callback')
      await redirectUrisInput.fill('https://new.example.com/callback')
      await expect(redirectUrisInput).toHaveValue('https://new.example.com/callback')
      await page.getByRole('button', { name: 'Save redirect URIs' }).click()
      await page.getByRole('button', { name: 'Disable application' }).click()
      await page.getByRole('button', { name: 'Enable application' }).click()
      await page.goto('/console/applications/confidential-app')
      await expect(page).toHaveURL(/\/console\/applications\/confidential-app\/settings$/)
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
        body: { disabled: true, disabledReason: 'Disabled from Console' },
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
      await page.goto('/console/connectors/passwordless')
      await expect(page.getByRole('heading', { name: 'Passwordless connectors' })).toBeVisible()
      await expect(page.getByText('Email connector')).toBeVisible()
      await expect(page.getByText('Email delivery is limited to the configured runtime email service binding.')).toBeVisible()
      await expect(page.getByText('SMS connector')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Email setup unavailable locally' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Setup SMS' })).toBeDisabled()
    },
  },
  'admin-social-connector-inventory': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console/connectors/social')
      await expect(page.getByRole('heading', { name: 'Social connectors' })).toBeVisible()
      await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'github', exact: true })).toBeVisible()
      await expect(page.getByText('read:user, user:email')).toBeVisible()
      await expect(page.getByLabel('Toggle GitHub')).toBeVisible()
    },
  },
  'admin-sign-in-settings': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/console/sign-in-experience/sign-up-and-sign-in')
      await expect(page.getByRole('heading', { name: 'Sign-up and sign-in' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Recovery and redirects' })).toBeVisible()
      await page.getByRole('switch', { name: 'Identifier-first flow' }).click()
      await page.getByLabel('Product name').fill('Northstar ID')
      await page.getByLabel('Headline').fill('Sign in to Northstar')
      await page.getByLabel('Description').fill('Use your Northstar identity to continue.')
      await page.getByLabel('Support email').fill('support@northstar.example')
      await page.getByRole('button', { name: 'Save sign-in settings' }).click()
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/management/sign-in-settings',
        body: {
          signIn: {
            passwordEnabled: true,
            signupEnabled: true,
            socialLoginEnabled: true,
            identifierFirst: true,
          },
          defaults: {
            applicationId: null,
            redirectUri: null,
          },
          links: {
            termsUri: null,
            privacyUri: null,
            supportEmail: 'support@northstar.example',
          },
          copy: {
            productName: 'Northstar ID',
            headline: 'Sign in to Northstar',
            description: 'Use your Northstar identity to continue.',
          },
        },
      })
    },
  },
  'admin-sign-in-experience-routes': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console/sign-in-experience/sign-up-and-sign-in')
      await expect(page.getByRole('tab', { name: 'Sign-up and sign-in' })).toHaveAttribute('aria-selected', 'true')

      for (const route of [
        {
          path: '/console/sign-in-experience/sign-up-and-sign-in',
          heading: 'Sign-up and sign-in',
        },
        { path: '/console/sign-in-experience/branding', heading: 'Branding' },
        { path: '/console/sign-in-experience/collect-user-profile', heading: 'Collect user profile' },
        { path: '/console/sign-in-experience/account-center', heading: 'Account Center' },
        { path: '/console/sign-in-experience/content', heading: 'Content' },
      ]) {
        await page.goto(route.path)
        await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`))
        await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible()
      }

      for (const route of [
        { tab: 'Branding', path: '/console/sign-in-experience/branding', heading: 'Branding' },
        {
          tab: 'Collect user profile',
          path: '/console/sign-in-experience/collect-user-profile',
          heading: 'Collect user profile',
        },
        { tab: 'Account Center', path: '/console/sign-in-experience/account-center', heading: 'Account Center' },
        { tab: 'Content', path: '/console/sign-in-experience/content', heading: 'Content' },
        {
          tab: 'Sign-up and sign-in',
          path: '/console/sign-in-experience/sign-up-and-sign-in',
          heading: 'Sign-up and sign-in',
        },
      ]) {
        await page.getByRole('tab', { name: route.tab }).click()
        await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`))
        await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible()
        await expect(page.getByRole('tab', { name: route.tab })).toHaveAttribute('aria-selected', 'true')
      }
    },
  },
  'admin-content-settings': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/console/sign-in-experience/content')
      await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
      await expect(page.getByLabel('Language')).toBeDisabled()
      await page.getByLabel('Product name').fill('Northstar Content')
      await page.getByLabel('Sign-in message').fill('Sign in with content copy')
      await page.getByLabel('Sign-up message').fill('Create content identity.')
      await page.getByLabel('Terms URL').fill('https://northstar.example.com/content-terms')
      await page.getByLabel('Privacy URL').fill('https://northstar.example.com/content-privacy')
      await page.getByLabel('Support email').fill('content@northstar.example')
      await page.getByRole('button', { name: 'Save content' }).click()
      await expect
        .poll(() =>
          requests.find(
            (request) =>
              request.path === '/api/management/sign-in-settings' &&
              (request.body as { copy?: { productName?: string } } | null)?.copy?.productName === 'Northstar Content',
          ),
        )
        .toEqual({
          method: 'PATCH',
          path: '/api/management/sign-in-settings',
          body: {
            links: {
              termsUri: 'https://northstar.example.com/content-terms',
              privacyUri: 'https://northstar.example.com/content-privacy',
              supportEmail: 'content@northstar.example',
            },
            copy: {
              productName: 'Northstar Content',
              headline: 'Sign in with content copy',
              description: 'Create content identity.',
            },
          },
        })
    },
  },
  'admin-security-policy': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console/mfa')
      await expect(page.getByRole('heading', { name: 'Multi-factor auth' })).toBeVisible()
      await expect(page.getByText('Passkeys', { exact: true })).toBeVisible()
      await expect(page.getByText('Authenticator app', { exact: true })).toBeVisible()
      await expect(page.getByText('SMS code', { exact: true })).toBeVisible()
      await expect(page.getByText('Email code', { exact: true })).toBeVisible()
      await expect(page.getByText('Backup codes', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Prompt policy')).toHaveValue('optional')
      await expect(page.getByLabel('Prompt policy')).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()

      await page.goto('/console/security/password-policy')
      await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Password policy' })).toBeVisible()
      await expect(page.getByLabel('Minimum length')).toBeDisabled()
      await expect(page.getByText('Required character types')).toBeVisible()
      await expect(page.getByText('Compromised-password rejection')).toBeVisible()

      await page.goto('/console/security/captcha')
      await expect(page.getByRole('heading', { name: 'CAPTCHA' })).toBeVisible()
      await expect(page.getByLabel('Provider')).toHaveValue('turnstile')
      await expect(page.getByRole('button', { name: 'Setup provider' })).toBeDisabled()

      await page.goto('/console/security/blocklist')
      await expect(page.getByRole('heading', { name: 'Blocklist', exact: true })).toBeVisible()
      await expect(page.getByText('Block email subaddressing')).toBeVisible()
      await expect(page.getByLabel('Custom email and domain blocklist')).toBeDisabled()

      await page.goto('/console/security/general')
      await expect(page.getByRole('heading', { name: 'General security' })).toBeVisible()
      await expect(page.getByText('MFA enforcement')).toBeVisible()
      await expect(page.getByText('3600s')).toBeVisible()
      await expect(page.getByText('Fresh age')).toBeVisible()
      await expect(page.getByText('Cookie cache')).toBeVisible()
    },
  },
  'admin-create-connector': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/console/connectors/social')
      await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Add social connector' }).click()
      await page.getByLabel('Template').selectOption('google')
      await page.getByLabel('Display name').fill('Google')
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
          scopes: ['openid', 'email', 'profile'],
        },
      })
      await page.getByLabel('Actions for GitHub').click()
      await page.getByText('View details').click()
      await expect(page.getByText('Secret binding available')).toBeVisible()
      await page.getByLabel('Display name').fill('GitHub Enterprise')
      await page.getByRole('button', { name: 'Save changes' }).click()
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/management/connectors/connector-1',
        body: expect.objectContaining({ displayName: 'GitHub Enterprise' }),
      })
      await page.getByRole('button', { name: 'Close' }).click()
      await page.goto('/console/connectors/social')
      await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
      await page.getByLabel('Actions for GitHub').click()
      await page.getByText('Delete').click()
      await page.getByRole('button', { name: 'Delete' }).click()
      expect(requests).toContainEqual({ method: 'DELETE', path: '/api/management/connectors/connector-1', body: null })
    },
  },
  'admin-create-organization': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console/organizations')
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
      await page.goto('/console/roles')
      await page.getByRole('button', { name: 'New role' }).click()
      await page.getByLabel('Key').fill('support')
      await page.getByLabel('Name').fill('Support')
      await page.getByRole('button', { name: 'Save' }).click()
    },
  },
  'admin-create-api-resource': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console/api-resources')
      await page.getByRole('button', { name: 'New resource' }).click()
      await page.getByLabel('Identifier').fill('orders')
      await page.getByLabel('Name').fill('Orders API')
      await page.getByLabel('Audience').fill('https://api.example.com/orders')
      await page.getByRole('button', { name: 'Save' }).click()
    },
  },
  'admin-authorization-inventory': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/console/organizations')
      await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible()
      await expect(page.getByText('Acme Inc.')).toBeVisible()
      await page.getByLabel('Upload logo for Acme').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      })
      await page.goto('/console/roles')
      await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible()
      await expect(page.getByRole('row').filter({ hasText: 'Support' }).filter({ hasText: 'support' })).toBeVisible()
      await page.getByRole('link', { name: 'Support' }).click()
      await expect(page).toHaveURL(/\/console\/roles\/role-1\/settings$/)
      await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible()
      await page.getByRole('tab', { name: 'Assignments' }).click()
      await expect(page).toHaveURL(/\/console\/roles\/role-1\/assignments$/)
      await expect(page.getByRole('button', { name: 'Assign role' })).toBeVisible()
      await page.goto('/console/api-resources')
      await expect(page.getByRole('heading', { name: 'API resources' })).toBeVisible()
      await expect(page.getByText('Orders API')).toBeVisible()
      await expect(page.getByText('https://api.example.com/orders')).toBeVisible()
      await page.getByRole('link', { name: 'Orders API' }).click()
      await expect(page).toHaveURL(/\/console\/api-resources\/resource-1\/settings$/)
      await expect(page.getByRole('heading', { name: 'Orders API' })).toBeVisible()
      await page.getByRole('tab', { name: 'Scopes' }).click()
      await expect(page).toHaveURL(/\/console\/api-resources\/resource-1\/scopes$/)
      await expect(page.getByRole('button', { name: 'Create scope' })).toBeVisible()
      await page.getByRole('tab', { name: 'Permissions' }).click()
      await expect(page).toHaveURL(/\/console\/api-resources\/resource-1\/permissions$/)
      await expect(page.getByRole('button', { name: 'Create permission' })).toBeVisible()
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/management/organizations/org-1/logo',
        body: '[form-data]',
      })
    },
  },
  'admin-branding-settings': {
    suite: 'admin management journeys',
    assert: async ({ page, requests }) => {
      await page.goto('/console/sign-in-experience/branding')
      const main = page.getByRole('main')
      await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible()
      await expect(main.getByText('Hosted sign-in preview')).toBeVisible()
      await page.getByLabel('Upload branding logo').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      })
      await page.getByLabel('Upload favicon').setInputFiles({
        name: 'favicon.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      })
      await expect
        .poll(() => requests.map((request) => request.path))
        .toEqual(expect.arrayContaining(['/api/management/branding/logo', '/api/management/branding/favicon']))
      await page.getByLabel('Logo URL').fill('https://cdn.example.com/northstar-logo.svg')
      await page.getByLabel('Favicon URL').fill('https://cdn.example.com/northstar.ico')
      await page.getByLabel('Primary color').fill('#2563eb')
      await page.getByLabel('Background color').fill('#ffffff')
      await page.getByLabel('Custom CSS').fill('--auth-panel-radius: 8px;')
      await page.getByRole('button', { name: 'Save branding' }).click()
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/management/branding-settings',
        body: {
          branding: {
            logoUrl: 'https://cdn.example.com/northstar-logo.svg',
            faviconUrl: 'https://cdn.example.com/northstar.ico',
            primaryColor: '#2563eb',
            backgroundColor: '#ffffff',
            customCss: '--auth-panel-radius: 8px;',
          },
          copy: {
            productName: 'Northstar Content',
            headline: 'Sign in with content copy',
            description: 'Create content identity.',
          },
        },
      })
      await page.goto('/sign-in')
      await expect(page.getByRole('heading', { name: 'Sign in with content copy' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Northstar Content' })).toBeVisible()
      expect(requests).toEqual(
        expect.arrayContaining([
          { method: 'POST', path: '/api/management/branding/logo', body: '[form-data]' },
          { method: 'POST', path: '/api/management/branding/favicon', body: '[form-data]' },
        ]),
      )
    },
  },
  'admin-deployment-settings': {
    suite: 'admin management journeys',
    assert: async ({ page }) => {
      await page.goto('/console/tenant-settings/oidc-configs')
      const main = page.getByRole('main')
      await expect(page.getByRole('heading', { name: 'OIDC configs' })).toBeVisible()
      await expect(main.getByRole('heading', { name: 'Runtime endpoints' })).toBeVisible()
      await expect(main.getByText('Platform')).toBeVisible()
      await expect(main.getByText('Cloudflare Workers')).toBeVisible()
      await expect(main.getByText('Database')).toBeVisible()
      await expect(main.getByText('D1')).toBeVisible()
      await expect(main.getByText('Auth issuer')).toBeVisible()
      await expect(main.getByText('/api/auth', { exact: true })).toBeVisible()
      await expect(main.getByText('Discovery')).toBeVisible()
      await expect(main.getByText('/api/auth/.well-known/openid-configuration')).toBeVisible()
      await expect(main.getByText('JWKS URI')).toBeVisible()
      await expect(main.getByText('/api/auth/jwks')).toBeVisible()
      await expect(main.getByText('Management API')).toBeVisible()
      await expect(main.getByText('/api/management')).toBeVisible()
      await expect(main.getByRole('heading', { name: 'Session TTL' })).toBeVisible()
      await expect(main.getByText('3600s')).toBeVisible()
      await expect(main.getByRole('heading', { name: 'Signing keys' })).toBeVisible()
      await expect(main.getByText('OIDC JWT signing')).toBeVisible()
      await expect(main.getByRole('button', { name: 'Rotate key' })).toBeDisabled()
    },
  },
}

test('declares browser E2E journey coverage above target', () => {
  const declaredIds = journeyCoverage.journeys.map((journey) => journey.id)
  const coveredIds = Object.keys(journeyAssertions)
  const visualJourneyIds = consoleRoutes.map((route) => route.journeyId)
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
  expect(new Set(consoleRoutes.map((route) => route.path)).size).toBe(consoleRoutes.length)
  expect(visualJourneyIds.every((id) => uniqueDeclaredIds.has(id))).toBe(true)
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
  test.setTimeout(90_000)

  await mockApi(page)

  await page.setViewportSize({ width: 1280, height: 720 })
  for (const route of consoleRoutes) {
    await test.step(`desktop 1280 ${route.name}`, async () => {
      await gotoConsoleVisualRoute(page, route)
      await expectConsoleRouteContent(page, route)
      await expectConsoleDesktopDensity(page, route.kind, route.heading)
      await expectNoDocumentHorizontalOverflow(page)
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`admin-${route.name}-1280x720.png`),
      })
    })
  }

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const route of consoleRoutes) {
      await test.step(`${viewport.name} ${route.name}`, async () => {
        await gotoConsoleVisualRoute(page, route)
        await expectConsoleRouteContent(page, route)
        if (viewport.name === 'desktop') {
          await expectConsoleDesktopDensity(page, route.kind, route.heading)
        } else {
          await expectConsoleMobileDensity(page)
        }
        await expectNoDocumentHorizontalOverflow(page)
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`admin-${route.name}-${viewport.name}.png`),
        })
        if (viewport.name === 'mobile' && route.name === 'dashboard') {
          await page.getByRole('button', { name: 'Open console navigation' }).click()
          await expect(page.getByRole('navigation', { name: 'Console mobile' })).toBeVisible()
          await expect(page.getByRole('link', { name: /Sign-in & account/ })).toBeVisible()
          await page.screenshot({
            fullPage: true,
            path: testInfo.outputPath('admin-dashboard-mobile-navigation.png'),
          })
          await page.getByRole('button', { name: 'Close console navigation' }).click()
        }
      })
    }
  }
})

test('hosted auth account and branding screenshot evidence', async ({ page }, testInfo) => {
  test.setTimeout(60_000)

  await mockApi(page)
  await mockPasskeys(page)

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const route of [...hostedAuthRoutes, ...accountRoutes]) {
      await test.step(`${viewport.name} ${route.name}`, async () => {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { name: route.heading })).toBeVisible()
        if (route.path.startsWith('/account')) await expectAccountSinglePageSections(page)
        if (
          route.path === '/sign-in' ||
          route.path === '/sign-up' ||
          route.path === '/forgot-password' ||
          'compactAuth' in route
        ) {
          await expectHostedAuthCompactShell(page)
        }
        await expectInitialViewportDensity(
          page,
          route.path.startsWith('/account')
            ? 'account'
            : route.path.startsWith('/oauth') || 'compactAuth' in route
              ? 'message'
              : 'hosted',
        )
        await expectNoDocumentHorizontalOverflow(page)
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`${route.name}-${viewport.name}.png`),
        })
      })
    }

    consentSessionAvailable = false
    try {
      await page.goto(
        '/oauth/consent?client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foidc%2Fcallback&state=state-1',
      )
      await expect(page.getByRole('heading', { name: 'Review application access.' })).toBeVisible()
      await expect(page.getByText('Authentication is required.')).toBeVisible()
      await expectHostedAuthCompactShell(page)
      await expectNoDocumentHorizontalOverflow(page)
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`oauth-consent-auth-required-${viewport.name}.png`),
      })
    } finally {
      consentSessionAvailable = true
    }
  }
})

type JourneyAssertionSuite = (typeof journeyAssertions)[JourneyId]['suite']
type ConsoleVisualRoute = (typeof consoleRoutes)[number]
type ConsolePageKind = ConsoleVisualRoute['kind']

async function runJourneySuite(suite: JourneyAssertionSuite, context: JourneyContext) {
  for (const [id, journey] of Object.entries(journeyAssertions)) {
    if (journey.suite === suite) {
      await test.step(id, () => journey.assert(context))
    }
  }
}

async function gotoConsoleVisualRoute(page: Page, route: ConsoleVisualRoute) {
  const setupRequired = 'setupRequired' in route && route.setupRequired
  adminSetupRequired = setupRequired
  await page.goto(route.path)
  await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll('/', '\\/')}$`))
}

async function expectConsoleRouteContent(page: Page, route: ConsoleVisualRoute) {
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible()
  await expect(main.getByText(route.sentinel, { exact: false }).first()).toBeVisible()
  await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1)
  if (route.path !== '/console') await expect(main.getByText('Setup progress')).toHaveCount(0)

  if (route.activeNav) {
    const consoleNav = page.getByRole('navigation', { name: 'Console' })
    if ((await consoleNav.count()) > 0) {
      await expect(consoleNav.getByRole('link', { name: route.activeNav })).toHaveClass(/bg-primary\/10/)
    }
  }
}

async function expectNoDocumentHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement
        return root.scrollWidth - root.clientWidth
      }),
    )
    .toBeLessThanOrEqual(1)
}

async function expectConsoleDesktopDensity(page: Page, kind: ConsolePageKind, heading: string) {
  const metrics = await page.evaluate((expectedHeading) => {
    const header = document.querySelector('header')
    const aside = document.querySelector('aside')
    const main = Array.from(document.querySelectorAll('main')).find(
      (element) =>
        !element.classList.contains('shell') &&
        !element.classList.contains('authShell') &&
        element.querySelector('h1')?.textContent?.trim() === expectedHeading &&
        element.getBoundingClientRect().height > 0,
    )
    const navRows = Array.from(document.querySelectorAll('nav[aria-label="Console"] a'))
    const content = main?.firstElementChild
    const pageHeading = main?.querySelector('h1')
    const firstPanel = main?.querySelector('[data-ui="card"], .consoleToolbar, .objectHeader')
    const firstTable = main?.querySelector('table')
    const firstAction = main?.querySelector('button, a[href], input, select, textarea')
    const controls = Array.from(
      main?.querySelectorAll('button, a.uiButton, input:not([type="file"]):not([type="color"]), select') ?? [],
    )
    const nestedCards = main?.querySelectorAll('[data-ui="card"] [data-ui="card"]').length ?? 0
    if (!header || !aside || !main || !content || navRows.length === 0) return null

    const headerBox = header.getBoundingClientRect()
    const asideBox = aside.getBoundingClientRect()
    const mainBox = main.getBoundingClientRect()
    const contentBox = content.getBoundingClientRect()
    const pageHeadingBox = pageHeading?.getBoundingClientRect()
    const firstPanelBox = firstPanel?.getBoundingClientRect()
    const firstTableBox = firstTable?.getBoundingClientRect()
    const firstActionBox = firstAction?.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const navRowHeights = navRows.map((row) => row.getBoundingClientRect().height)
    const controlHeights = controls.map((control) => control.getBoundingClientRect().height)
    const pageHeadingStyle = pageHeading ? window.getComputedStyle(pageHeading) : null

    return {
      topbarHeight: headerBox.height,
      sidebarWidth: asideBox.width,
      navRowHeights,
      mainStartX: mainBox.x,
      mainStartY: mainBox.y,
      mainWidth: mainBox.width,
      contentStartX: contentBox.x,
      contentStartY: contentBox.y,
      contentWidth: contentBox.width,
      contentInlineOffset: contentBox.x - mainBox.x,
      contentBlockCount: content.children.length,
      firstPanelHeight: firstPanelBox?.height ?? 0,
      firstPanelTop: firstPanelBox?.y ?? 0,
      firstTableTop: firstTableBox?.y ?? 0,
      firstActionBottom: firstActionBox?.bottom ?? 0,
      headingTop: pageHeadingBox?.y ?? 0,
      headingFontSize: pageHeadingStyle ? Number.parseFloat(pageHeadingStyle.fontSize) : 0,
      nestedCards,
      controlHeights,
      scrollRatio: document.documentElement.scrollHeight / viewportHeight,
    }
  }, heading)

  expect(metrics).not.toBeNull()
  expect(metrics?.topbarHeight).toBe(64)
  expect(metrics?.sidebarWidth).toBe(248)
  expect(metrics?.navRowHeights.every((height) => height <= 36)).toBe(true)
  expect(metrics?.mainStartX).toBe(248)
  expect(metrics?.mainStartY).toBe(64)
  expect(metrics?.contentWidth).toBeLessThanOrEqual(1040)
  expect(metrics?.contentStartX).toBeLessThanOrEqual(380)
  expect(metrics?.contentInlineOffset).toBeLessThanOrEqual(124)
  expect(metrics?.contentStartY).toBeLessThanOrEqual(97)
  expect(metrics?.headingTop).toBeLessThanOrEqual(150)
  expect(metrics?.headingFontSize).toBeLessThanOrEqual(24)
  expect(metrics?.firstPanelTop).toBeLessThanOrEqual(300)
  if (kind === 'shell' || kind === 'list') expect(metrics?.firstPanelHeight).toBeLessThanOrEqual(400)
  expect(metrics?.nestedCards).toBe(0)
  expect(metrics?.controlHeights.every((height) => height <= 64)).toBe(true)
  expect(metrics?.scrollRatio).toBeLessThanOrEqual(kind === 'detail' ? 3.8 : 3.2)
  if (kind === 'list') expect(metrics?.firstTableTop).toBeLessThanOrEqual(320)
  if (kind === 'settings' || kind === 'detail') expect(metrics?.firstActionBottom).toBeLessThanOrEqual(720)
}

async function expectConsoleMobileDensity(page: Page) {
  const metrics = await page.evaluate(() => {
    const aside = document.querySelector('aside')
    const main = Array.from(document.querySelectorAll('main')).find(
      (element) =>
        !element.classList.contains('shell') &&
        !element.classList.contains('authShell') &&
        element.getBoundingClientRect().height > 0,
    )
    const heading = main?.querySelector('h1')
    const asideStyle = aside ? window.getComputedStyle(aside) : null
    const headingBox = heading?.getBoundingClientRect()
    return {
      asideVisible: asideStyle ? asideStyle.display !== 'none' : false,
      headingTop: headingBox?.y ?? 0,
      headingBottom: headingBox?.bottom ?? 0,
      viewportHeight: window.innerHeight,
    }
  })

  expect(metrics.asideVisible).toBe(false)
  expect(metrics.headingTop).toBeGreaterThanOrEqual(64)
  expect(metrics.headingBottom).toBeLessThanOrEqual(220)
}

async function expectHostedAuthCompactShell(page: Page) {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.authShell')
    const panel = document.querySelector('.authPanel')
    const brandPanel = document.querySelector('.authBrandPanel')
    const content = document.querySelector('.authContent')
    const heading = document.querySelector('.authBrandPanel h1')
    const inputs = Array.from(document.querySelectorAll('.authPanel input'))
    const buttons = Array.from(document.querySelectorAll('.authPanel button, .authPanel .uiButton'))
    if (!shell || !panel || !brandPanel || !content || !heading) return null

    const shellBox = shell.getBoundingClientRect()
    const panelBox = panel.getBoundingClientRect()
    const brandPanelBox = brandPanel.getBoundingClientRect()
    const contentBox = content.getBoundingClientRect()
    const panelStyle = window.getComputedStyle(panel)
    const headingStyle = window.getComputedStyle(heading)

    return {
      panelWidth: panelBox.width,
      panelHeight: panelBox.height,
      panelTop: panelBox.y,
      panelBottom: panelBox.bottom,
      panelCenterOffset: Math.abs(panelBox.x + panelBox.width / 2 - shellBox.width / 2),
      panelBorderTopWidth: Number.parseFloat(panelStyle.borderTopWidth),
      panelBoxShadow: panelStyle.boxShadow,
      panelHasVisualBoundary: Number.parseFloat(panelStyle.borderTopWidth) > 0 || panelStyle.boxShadow !== 'none',
      headingFontSize: Number.parseFloat(headingStyle.fontSize),
      brandToContentGap: contentBox.y - brandPanelBox.bottom,
      inputHeights: inputs.map((input) => input.getBoundingClientRect().height),
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      heroCount: shell.querySelectorAll('.hero').length,
      oversizedMediaCount: Array.from(shell.querySelectorAll('img, video')).filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 80 || box.height > 80
      }).length,
      scrollRatio: document.documentElement.scrollHeight / window.innerHeight,
      viewportHeight: window.innerHeight,
    }
  })

  expect(metrics).not.toBeNull()
  expect(metrics?.panelWidth).toBeLessThanOrEqual(400)
  expect(metrics?.panelHeight).toBeLessThanOrEqual(metrics?.viewportHeight ?? 0)
  expect(metrics?.panelTop).toBeGreaterThanOrEqual(20)
  expect(metrics?.panelBottom).toBeLessThanOrEqual((metrics?.viewportHeight ?? 0) + 60)
  expect(metrics?.panelCenterOffset).toBeLessThanOrEqual(1)
  expect(metrics?.panelBorderTopWidth).toBeLessThanOrEqual(1)
  expect(metrics?.panelHasVisualBoundary).toBe(true)
  expect(metrics?.headingFontSize).toBeLessThanOrEqual(24)
  expect(metrics?.brandToContentGap).toBeLessThanOrEqual(28)
  expect(metrics?.inputHeights.every((height) => height >= 38 && height <= 44)).toBe(true)
  expect(metrics?.buttonHeights.every((height) => height >= 32 && height <= 44)).toBe(true)
  expect(metrics?.heroCount).toBe(0)
  expect(metrics?.oversizedMediaCount).toBe(0)
  expect(metrics?.scrollRatio).toBeLessThanOrEqual(1.4)
}

async function expectInitialViewportDensity(page: Page, surface: 'account' | 'hosted' | 'message') {
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('main')
    const heading = main?.querySelector('h1')
    const firstAction = main?.querySelector('button, a[href], input, select, textarea')
    const headingBox = heading?.getBoundingClientRect()
    const firstActionBox = firstAction?.getBoundingClientRect()
    return {
      headingTop: headingBox?.y ?? 0,
      headingBottom: headingBox?.bottom ?? 0,
      firstActionBottom: firstActionBox?.bottom ?? 0,
      scrollRatio: document.documentElement.scrollHeight / window.innerHeight,
      viewportHeight: window.innerHeight,
    }
  })

  expect(metrics.headingTop).toBeGreaterThanOrEqual(0)
  expect(metrics.headingBottom).toBeLessThanOrEqual(surface === 'hosted' ? 440 : 520)
  expect(metrics.firstActionBottom).toBeLessThanOrEqual(metrics.viewportHeight)
  expect(metrics.scrollRatio).toBeLessThanOrEqual(3.2)
}

async function expectAccountSinglePageSections(page: Page) {
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('navigation', { name: 'Account center' })).toHaveCount(0)

  for (const section of accountSections) {
    await expect(page.getByRole('heading', { name: section })).toBeVisible()
  }

  await expect(page.locator('.accountSectionStack > .settingsPanel')).toHaveCount(accountSections.length)
}

async function mockApi(page: Page) {
  const requests: RequestRecord[] = []
  accountSignedIn = true
  accountApplicationRevoked = false
  accountMfaEnabled = false
  consentSessionAvailable = true

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = requestBody(request)

    if (!path.startsWith('/api/')) {
      await route.continue()
      return
    }

    if (method !== 'GET') requests.push({ method, path, body })

    if (path === '/api/auth/oauth2/authorize') {
      await route.fulfill({
        status: 302,
        headers: { location: `/oidc/callback?code=auth-code&state=${url.searchParams.get('state') ?? ''}` },
      })
      return
    }

    if (!accountSignedIn && path.startsWith('/api/account/')) {
      await fulfill(route, { error: 'Authentication is required.' }, 401)
      return
    }

    if (!consentSessionAvailable && path === '/api/oauth/consent' && method === 'GET') {
      await fulfill(route, { error: { message: 'Authentication is required.' } }, 401)
      return
    }

    await fulfill(route, await responseFor(path, method, body))
  })

  return requests
}

function requestBody(request: Request) {
  const contentType = request.headers()['content-type'] ?? ''
  if (contentType.startsWith('multipart/form-data')) return '[form-data]'
  return request.postDataJSON() ?? null
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
  if (path === '/api/onboarding/console-users') {
    return {
      user: { id: 'user-admin', email: 'admin@example.com', role: 'admin' },
      onboarding: { locked: true },
    }
  }
  if (path === '/api/oauth/consent' && method === 'GET') return consentResponse
  if (path === '/api/auth/sign-out' && method === 'POST') {
    accountSignedIn = false
    return {}
  }
  if (path === '/api/auth/sign-in/email' && method === 'POST') {
    accountSignedIn = true
    return { ok: true }
  }
  if (path === '/api/management/sign-in-settings') {
    if (method === 'PATCH') {
      const input = body as {
        signIn?: Partial<typeof configz.signIn>
        defaults?: Partial<typeof configz.defaults>
        links?: Partial<typeof configz.links>
        copy?: Partial<typeof configz.copy>
      }
      Object.assign(configz.signIn, input.signIn)
      Object.assign(configz.defaults, input.defaults)
      Object.assign(configz.links, input.links)
      Object.assign(configz.copy, input.copy)
    }
    return {
      signIn: configz.signIn,
      defaults: configz.defaults,
      links: configz.links,
      copy: configz.copy,
    }
  }
  if (path === '/api/management/branding-settings') {
    if (method === 'PATCH') {
      const input = body as { branding?: Partial<typeof configz.branding>; copy?: Partial<typeof configz.copy> }
      Object.assign(configz.branding, input.branding)
      Object.assign(configz.copy, input.copy)
    }
    return {
      branding: configz.branding,
      copy: configz.copy,
    }
  }
  if (path === '/api/management/readiness') {
    return {
      required: [
        {
          id: 'oidc_application',
          label: 'Create an OIDC application',
          description: 'Register the first client so product routes can complete authorization code flows.',
          status: adminSetupRequired ? 'action_needed' : 'complete',
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
          description: 'Email binding and sender settings are needed for verification, OTP, magic link, and reset flows.',
          status: 'complete',
          href: '/console/tenant-settings/oidc-configs',
          action: 'Review deployment',
        },
      ],
      admin: {
        setupRequired: adminSetupRequired,
        setupHref: '/console/onboarding',
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
  if (path === '/api/management/applications/app-1/logo') return { asset: uploadedAsset }
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
    return { users: [{ ...user, banned: adminUserBanned, emailVerified: true }], pagination }
  }
  if (path === '/api/management/users/user-1') {
    if (method === 'PATCH') return { user: { ...profile, ...(body as object), banned: adminUserBanned } }
    if (method === 'DELETE') return null
    return { user: { ...profile, banned: adminUserBanned } }
  }
  if (path === '/api/management/users/user-1/password-reset-requests') return { status: true }
  if (path === '/api/management/users/user-1/ban') {
    adminUserBanned = method === 'PUT'
    return { user: { ...profile, banned: adminUserBanned } }
  }
  if (path === '/api/management/users/user-1/sessions') {
    if (method === 'DELETE') return { success: true }
    return { sessions: [session], pagination }
  }
  if (path === '/api/management/users/user-1/sessions/session-1') return { success: true }
  if (path === '/api/management/users/user-1/linked-accounts') return { accounts: [linkedAccount], pagination }
  if (path === '/api/management/users/user-1/applications') {
    return {
      applications: [
        {
          id: 'consent-1',
          applicationId: 'app-1',
          applicationName: 'Customer portal',
          applicationSlug: 'customer-portal',
          scopes: ['openid', 'profile'],
          permissions: null,
          grantedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
        },
      ],
      pagination,
    }
  }
  if (path === '/api/management/users/user-1/security') {
    return {
      security: {
        userId: 'user-1',
        mfa: { enabled: true, factors: [{ id: 'factor-1', type: 'totp', verified: true }] },
        passkeys: { enabled: true, count: 1 },
        policy: securityPolicy,
      },
    }
  }
  if (path === '/api/management/users/user-1/passkeys/passkey-1') return { success: true }
  if (path === '/api/management/users/user-1/passkeys') {
    return {
      passkeys: [
        {
          id: 'passkey-1',
          name: 'MacBook Touch ID',
          userId: 'user-1',
          deviceType: 'single_device',
          backedUp: false,
          transports: 'internal',
          createdAt: '2026-01-01T00:00:00.000Z',
          aaguid: null,
        },
      ],
      pagination,
    }
  }
  if (path === '/api/management/connectors') {
    if (method === 'POST') return connector
    return { connectors: [connector], pagination }
  }
  if (path === '/api/management/connectors/templates') return connectorTemplates
  if (path === '/api/management/connectors/connector-1/readiness') {
    return {
      connectorId: 'connector-1',
      ready: false,
      checks: [
        {
          key: 'clientSecretAvailable',
          label: 'Secret binding available',
          ok: false,
          message: 'Secret binding is not available in the runtime.',
        },
      ],
    }
  }
  if (path === '/api/management/connectors/connector-1') {
    if (method === 'PATCH') return { ...connector, ...(body && typeof body === 'object' ? body : {}) }
    if (method === 'DELETE') return {}
    return connector
  }
  if (path === '/api/management/organizations') {
    if (method === 'POST') return organization
    return { organizations: [organization], pagination }
  }
  if (path === '/api/management/organizations/org-1') {
    if (method === 'PATCH') return { ...organization, ...(body && typeof body === 'object' ? body : {}) }
    return organization
  }
  if (path === '/api/management/organizations/org-1/logo') return { asset: uploadedAsset }
  if (path === '/api/management/branding/logo') return { asset: uploadedAsset }
  if (path === '/api/management/branding/favicon') return { asset: uploadedAsset }
  if (path === '/api/management/roles') {
    if (method === 'POST') return role
    return { roles: [role], pagination }
  }
  if (path === '/api/management/roles/role-1') return role
  if (path === '/api/management/roles/role-1/permissions') {
    if (method === 'PUT') return null
    return { permissions: [apiPermission] }
  }
  if (path === '/api/management/user-role-assignments') return null
  if (path === '/api/management/application-role-assignments') return null
  if (path === '/api/management/member-role-assignments') return null
  if (path === '/api/management/api-resources') {
    if (method === 'POST') return apiResource
    return { resources: [apiResource], pagination }
  }
  if (path === '/api/management/api-resources/resource-1') return apiResource
  if (path === '/api/management/api-resources/resource-1/scopes') {
    if (method === 'POST') return apiScope
    return { scopes: [apiScope], pagination }
  }
  if (path === '/api/management/api-resources/resource-1/scopes/scope-1') return apiScope
  if (path === '/api/management/api-resources/resource-1/permissions') {
    if (method === 'POST') return apiPermission
    return { permissions: [apiPermission], pagination }
  }
  if (path === '/api/management/api-resources/resource-1/permissions/permission-1') return apiPermission
  if (path === '/api/account/profile') return { user: profile }
  if (path === '/api/account/avatar') return { asset: uploadedAsset }
  if (path === '/api/account/linked-accounts') return { accounts: [linkedAccount] }
  if (path === '/api/account/applications') {
    return { applications: accountApplicationRevoked ? [] : [accountApplicationConsent] }
  }
  if (path === '/api/account/applications/consent-1' && method === 'DELETE') {
    accountApplicationRevoked = true
    return null
  }
  if (path === '/api/account/sessions') return { sessions: [session] }
  if (path === '/api/account/security') {
    return {
      security: {
        ...securityState,
        mfa: accountMfaEnabled ? { enabled: true, factors: [{ id: 'totp-1', type: 'totp', verified: true }] } : securityState.mfa,
      },
    }
  }
  if (path === '/api/account/security/mfa/totp-enrollment') return totpEnrollment
  if (path === '/api/account/security/mfa/totp-verification') {
    accountMfaEnabled = true
    return { verified: true }
  }
  if (path === '/api/account/security/mfa/totp' && method === 'DELETE') {
    accountMfaEnabled = false
    return null
  }
  if (path === '/api/account/security/passkeys') return { passkeys: [passkey] }
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
  identityProviders: [
    {
      slug: 'github',
      providerType: 'social',
      providerId: 'github',
      displayName: 'GitHub',
      icon: 'github',
    },
  ],
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
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
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
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
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
  slug: 'github',
  providerId: 'github',
  providerType: 'social',
  displayName: 'GitHub',
  enabled: true,
  clientId: 'github-client',
  clientSecretBinding: 'GITHUB_SECRET',
  issuer: null,
  authorizationEndpoint: null,
  tokenEndpoint: null,
  userInfoEndpoint: null,
  jwksEndpoint: null,
  scopes: ['read:user', 'user:email'],
  providerMetadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const connectorTemplates = {
  templates: [
    {
      providerType: 'social',
      providerId: 'google',
      displayName: 'Google',
      icon: 'google',
      requiredFields: ['clientId', 'clientSecretBinding'],
      optionalFields: ['scopes'],
      defaultScopes: ['openid', 'email', 'profile'],
      endpoints: {
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
      },
    },
  ],
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

const uploadedAsset = {
  id: 'asset-1',
  purpose: 'avatar',
  publicUrl: '/api/assets/asset-1',
  contentType: 'image/png',
  byteSize: 8,
  checksumSha256: 'checksum-1',
  createdAt: '2026-01-01T00:00:00.000Z',
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

const accountApplicationConsent = {
  id: 'consent-1',
  applicationName: 'Customer portal',
  applicationSlug: 'customer-portal',
  scopes: ['openid', 'profile'],
  grantedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
}

const passkey = {
  id: 'passkey-1',
  name: 'Laptop key',
  deviceType: 'singleDevice',
  backedUp: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const securityPolicy = {
  mfa: { mode: 'optional' },
  passkeys: { enabled: true, rpId: 'localhost', rpName: 'Acme ID', origins: ['http://127.0.0.1:5173'] },
  sessions: { expiresInSeconds: 3600, updateAgeSeconds: 300, freshAgeSeconds: 300, cookieCacheSeconds: 60 },
}

const securityState = {
  mfa: { enabled: false, factors: [] },
  passkeys: { enabled: true, count: 1 },
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
  resourceId: 'resource-1',
  organizationId: null,
  applicationId: null,
  system: false,
  tokenClaimName: null,
  tokenClaimValue: null,
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
  enabled: true,
  tokenClaimsNamespace: null,
  scopes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const apiScope = {
  id: 'scope-1',
  resourceId: 'resource-1',
  value: 'orders:read',
  description: 'Read orders',
  required: false,
  tokenClaimName: null,
  includeInAccessToken: true,
  includeInIdToken: false,
}

const apiPermission = {
  id: 'permission-1',
  resourceId: 'resource-1',
  scopeId: 'scope-1',
  key: 'orders.read',
  description: 'Read orders',
  tokenClaimValue: 'read',
}

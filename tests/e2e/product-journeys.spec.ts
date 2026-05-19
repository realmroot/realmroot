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
      await page.goto('/oauth/consent?client_id=client-1&redirect_uri=http%3A%2F%2Flocalhost%3A4173%2Foidc%2Fcallback')
      await expect(page.getByRole('heading', { name: 'Customer portal' })).toBeVisible()
      await page.getByRole('button', { name: 'Approve access' }).click()
      expect(requests).toContainEqual({
        method: 'POST',
        path: '/api/oauth/consent',
        body: { clientId: 'client-1', scopes: ['openid', 'profile'] },
      })
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

    await fulfill(route, await responseFor(path, method))
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

async function responseFor(path: string, method: string): Promise<unknown> {
  if (path === '/api/health') {
    const response = await createApp(createAuthMock()).request('/api/health', { method })
    return response.json()
  }
  if (path === '/api/configz') {
    return { ...configz, onboarding: { required: firstAdminRequired, href: '/onboarding' } }
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

const consentResponse = {
  application,
  requestedScopes: ['openid', 'profile'],
  existingConsent: null,
  state: null,
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

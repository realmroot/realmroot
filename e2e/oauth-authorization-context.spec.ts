import { createHash } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { baseURL, resetAndBootstrap, signIn, signOut } from './helpers/real-app'

const nativeResource = `http://127.0.0.1:${process.env.E2E_NATIVE_PORT ?? '4400'}/api`
const redirectUri = `${baseURL}/e2e/oauth-callback`
const organizationClaim = 'urn:realmroot:params:oauth:org'

test.describe('OAuth authorization Context selection', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
  })

  test('[spec: hosted-auth/oauth-authorization-context-selection] issues tokens only for the explicitly selected User or Organization Context', async ({
    page,
  }) => {
    await signIn(page)

    const platformOrganizationId = await findPlatformOrganization(page)
    const alphaOrganization = await createOrganization(page, 'Alpha Context', 'alpha-context')
    const betaOrganization = await createOrganization(page, 'Beta Context', 'beta-context')
    const clientId = await createPublicSpaAndNativeResource(page, platformOrganizationId)
    const consentClientId = await createPublicSpa(page, platformOrganizationId, {
      name: 'OAuth Context Consent SPA',
      slug: 'oauth-context-consent-spa',
      consentRequired: true,
    })

    await signOut(page)
    await signIn(page)
    await setActiveOrganization(page, betaOrganization.id)
    await startAuthorization(page, clientId, 'user-context-state')

    await expect(page).toHaveURL(/\/auth\/context\?/)
    await expect(page.getByRole('heading', { name: 'Choose an authorization Context' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Continue with' })).toBeVisible()

    const userContext = page.getByRole('radio', { name: /Realmroot Admin/ })
    const alphaContext = page.getByRole('radio', { name: /Alpha Context/ })
    const betaContext = page.getByRole('radio', { name: /Beta Context/ })
    await expect(userContext).toBeVisible()
    await expect(alphaContext).toBeVisible()
    await expect(betaContext).toBeVisible()
    await expect(userContext).not.toBeChecked()
    await expect(alphaContext).not.toBeChecked()
    await expect(betaContext).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await userContext.focus()
    await page.keyboard.press('Space')
    await expect(userContext).toBeFocused()
    await expect(userContext).toBeChecked()

    const userTokens = await continueAndExchangeCode(page, clientId, 'user-context-state')
    expect(decodeJwtPayload(userTokens.accessToken)).not.toHaveProperty(organizationClaim)

    await startAuthorization(page, clientId, 'organization-context-state')
    await expect(page).toHaveURL(/\/auth\/context\?/)
    const selectedOrganization = page.getByRole('radio', { name: /Alpha Context/ })
    await selectedOrganization.focus()
    await page.keyboard.press('Space')
    await expect(selectedOrganization).toBeFocused()
    await expect(selectedOrganization).toBeChecked()

    const organizationTokens = await continueAndExchangeCode(page, clientId, 'organization-context-state')
    expect(decodeJwtPayload(organizationTokens.accessToken)[organizationClaim]).toBe(alphaOrganization.id)

    await startAuthorization(page, consentClientId, 'consent-alpha-state')
    await expect(page).toHaveURL(/\/auth\/context\?/)
    await page.getByRole('radio', { name: /Alpha Context/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(/\/auth\/consent\?/)
    await expect(page.getByRole('heading', { name: 'OAuth Context Consent SPA' })).toBeVisible()
    await page.getByRole('button', { name: 'Authorize' }).click()
    const consentCode = await callbackCode(page, 'consent-alpha-state')
    const consentTokens = await exchangeCode(page, consentClientId, 'consent-alpha-state', consentCode)
    expect(decodeJwtPayload(consentTokens.accessToken)[organizationClaim]).toBe(alphaOrganization.id)
    expect(decodeJwtPayload(consentTokens.idToken)[organizationClaim]).toBe(alphaOrganization.id)

    const alphaTab = await page.context().newPage()
    const betaTab = await page.context().newPage()
    await Promise.all([
      startAuthorization(alphaTab, clientId, 'parallel-alpha-state'),
      startAuthorization(betaTab, clientId, 'parallel-beta-state'),
    ])
    await expect(alphaTab).toHaveURL(/\/auth\/context\?/)
    await expect(betaTab).toHaveURL(/\/auth\/context\?/)

    await alphaTab.getByRole('radio', { name: /Alpha Context/ }).focus()
    await alphaTab.keyboard.press('Space')
    await expect(alphaTab.getByRole('radio', { name: /Alpha Context/ })).toBeChecked()
    await betaTab.getByRole('radio', { name: /Beta Context/ }).focus()
    await betaTab.keyboard.press('Space')
    await expect(betaTab.getByRole('radio', { name: /Beta Context/ })).toBeChecked()

    const alphaCode = await continueAuthorization(alphaTab, 'parallel-alpha-state')
    const betaCode = await continueAuthorization(betaTab, 'parallel-beta-state')
    const betaTokens = await exchangeCode(betaTab, clientId, 'parallel-beta-state', betaCode)
    const alphaTokens = await exchangeCode(alphaTab, clientId, 'parallel-alpha-state', alphaCode)
    expect(decodeJwtPayload(alphaTokens.accessToken)[organizationClaim]).toBe(alphaOrganization.id)
    expect(decodeJwtPayload(betaTokens.accessToken)[organizationClaim]).toBe(betaOrganization.id)
  })
})

async function findPlatformOrganization(page: Page): Promise<string> {
  const response = await page.request.get('/api/organizations?limit=100&offset=0')
  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as { items: Array<{ id: string; slug: string }> }
  const platform = body.items.find((organization) => organization.slug === 'realmroot')
  expect(platform).toBeTruthy()
  return platform!.id
}

async function createOrganization(page: Page, name: string, slug: string): Promise<{ id: string }> {
  const response = await page.request.post('/api/organizations', { data: { name, slug } })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()) as { id: string }
}

async function createPublicSpaAndNativeResource(page: Page, platformOrganizationId: string): Promise<string> {
  const resourceResponse = await page.request.post('/api/resource-servers', {
    data: {
      identifier: 'oauth-context-native-resource',
      resourceUrl: nativeResource,
      authorizationModel: 'native',
      ownerOrganizationId: platformOrganizationId,
      visibility: 'public',
    },
  })
  expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)

  return createPublicSpa(page, platformOrganizationId, {
    name: 'OAuth Context SPA',
    slug: 'oauth-context-spa',
    consentRequired: false,
  })
}

async function createPublicSpa(
  page: Page,
  platformOrganizationId: string,
  application: { name: string; slug: string; consentRequired: boolean },
): Promise<string> {
  const applicationResponse = await page.request.post('/api/applications', {
    data: {
      name: application.name,
      slug: application.slug,
      clientType: 'public_spa',
      redirectUris: [redirectUri],
      corsOrigins: [baseURL],
      ownerOrganizationId: platformOrganizationId,
      visibility: 'public',
      consentRequired: application.consentRequired,
    },
  })
  expect(applicationResponse.status(), await applicationResponse.text()).toBe(201)
  const createdApplication = (await applicationResponse.json()) as { clientId: string }
  return createdApplication.clientId
}

async function setActiveOrganization(page: Page, organizationId: string | null) {
  const response = await page.request.post('/api/auth/organization/set-active', {
    headers: { origin: baseURL },
    data: { organizationId },
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function startAuthorization(page: Page, clientId: string, state: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: pkceChallenge(verifierFor(state)),
    code_challenge_method: 'S256',
    resource: nativeResource,
  })
  await page.goto(`/api/auth/oauth2/authorize?${params}`)
}

async function continueAndExchangeCode(page: Page, clientId: string, state: string): Promise<OAuthTokens> {
  const code = await continueAuthorization(page, state)
  return exchangeCode(page, clientId, state, code)
}

async function continueAuthorization(page: Page, state: string): Promise<string> {
  await page.getByRole('button', { name: 'Continue' }).click()
  return callbackCode(page, state)
}

async function callbackCode(page: Page, state: string): Promise<string> {
  await page.waitForURL((url) => url.pathname === '/e2e/oauth-callback' && url.searchParams.has('code'))
  const callback = new URL(page.url())
  expect(callback.searchParams.get('state')).toBe(state)
  const code = callback.searchParams.get('code')
  expect(code).toBeTruthy()
  return code!
}

type OAuthTokens = { accessToken: string; idToken: string }

async function exchangeCode(page: Page, clientId: string, state: string, code: string): Promise<OAuthTokens> {
  const response = await page.request.post('/api/auth/oauth2/token', {
    headers: { origin: baseURL },
    form: {
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifierFor(state),
      resource: nativeResource,
    },
  })
  expect(response.status(), await response.text()).toBe(200)
  const tokens = (await response.json()) as { access_token: string; id_token: string }
  return { accessToken: tokens.access_token, idToken: tokens.id_token }
}

function verifierFor(state: string): string {
  return `${state}-pkce-verifier-0123456789-abcdefghijklmnopqrstuvwxyz`
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  expect(payload).toBeTruthy()
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplicationResponse, CreateConsentRequest } from '../shared/api/applications'
import type {
  ApiPermissionResponse,
  ApiResourceResponse,
  ApiScopeResponse,
  AssignRoleRequest,
  MemberResponse,
  OrganizationResponse,
  RoleResponse,
} from '../shared/api/authorization'
import type { SecurityPolicy } from '../shared/api/security'
import { createApp } from './app'
import type { UserRepository } from './modules/users/repository'

const releaseState = vi.hoisted(() => ({
  applications: null as ReturnType<typeof createApplicationServiceDouble> | null,
  authorization: null as ReturnType<typeof createAuthorizationServiceDouble> | null,
}))

vi.mock('./modules/applications/context', () => ({
  createApplicationService: () => releaseState.applications,
}))

vi.mock('./modules/authorization/context', () => ({
  createAuthorizationService: () => releaseState.authorization,
}))

describe('v1.0 release product journey', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    releaseState.applications = createApplicationServiceDouble()
    releaseState.authorization = createAuthorizationServiceDouble()
  })

  it('covers onboarding, OAuth, admin, account, connector, MFA/passkey, RBAC claims, and deployment boundaries', async () => {
    const onboarding = createOnboardingRepositoryDouble()
    const auth = createAuthDouble()
    const users = createUserRepositoryDouble()
    const security = createSecurityRepositoryDouble()
    const connectors = createConnectorServiceDouble()
    const app = createApp(auth, {
      trustedOrigins: ['https://console.example.com'],
      onboardingRepository: onboarding,
      userRepository: users,
      securityRepository: security,
      securityPolicy: securityPolicy(),
      connectorServiceFactory: () => connectors,
    })

    const lockedAuth = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'password-1' }),
    })
    expect(lockedAuth.status).toBe(403)

    await expectJson(await app.request('/api/onboarding/status'), 200, { required: true })
    await expectJson(
      await app.request('/api/onboarding/admin-users', {
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'password-1',
          name: 'Admin User',
          username: 'admin',
        }),
      }),
      201,
      {
        onboarding: { locked: true },
        user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
      },
    )

    const untrusted = await app.request('/api/health', { headers: { origin: 'https://evil.example.com' } })
    expect(untrusted.status).toBe(403)

    const client = await expectJson<ApplicationResponse & { clientSecret: string }>(
      await app.request('/api/admin/applications', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          name: 'Acme Portal',
          clientType: 'confidential_web',
          redirectUris: ['https://app.example.com/callback'],
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
          allowedScopes: ['openid', 'profile', 'email'],
          trusted: true,
        }),
      }),
      201,
      { clientId: 'client-1', clientSecret: 'secret-1', tokenEndpointAuthMethod: 'client_secret_basic' },
    )

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'user-1@example.com', password: 'password-1' }),
    })
    expect(signIn.status).toBe(200)
    expect(signIn.headers.get('set-cookie')).toContain('flareauth.session=session-1')

    const authorizationUrl = `/api/auth/oauth2/authorize?client_id=${client.clientId}&redirect_uri=https://app.example.com/callback&response_type=code&scope=openid%20profile%20email&state=state-1`
    const hostedSignIn = await app.request(authorizationUrl)
    expect(hostedSignIn.status).toBe(302)
    expect(hostedSignIn.headers.get('location')).toBe('http://localhost/sign-in')

    await expectJson(
      await app.request(
        `/api/oauth/consent?client_id=${client.clientId}&redirect_uri=https://app.example.com/callback&scope=openid%20profile%20email&state=state-1`,
        { headers: userHeaders() },
      ),
      200,
      {
        application: { clientId: client.clientId, name: 'Acme Portal' },
        requestedScopes: ['openid', 'profile', 'email'],
        state: 'state-1',
      },
    )
    await expectJson(
      await app.request('/api/oauth/consent', {
        method: 'POST',
        headers: userHeaders(),
        body: JSON.stringify({ clientId: client.clientId, scopes: ['openid', 'profile', 'email'] }),
      }),
      201,
      { consent: { id: 'consent-1', scopes: ['openid', 'profile', 'email'] } },
    )

    const resource = await expectJson<ApiResourceResponse>(
      await app.request('/api/admin/api-resources', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          identifier: 'contacts-api',
          name: 'Contacts API',
          audience: 'https://api.example.com/contacts',
          tokenClaimsNamespace: 'https://claims.example.com/contacts',
        }),
      }),
      201,
      { identifier: 'contacts-api', audience: 'https://api.example.com/contacts' },
    )
    const scope = await expectJson<ApiScopeResponse>(
      await app.request(`/api/admin/api-resources/${resource.id}/scopes`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ value: 'contacts:read', includeInAccessToken: true }),
      }),
      201,
      { value: 'contacts:read' },
    )
    const permission = await expectJson<ApiPermissionResponse>(
      await app.request(`/api/admin/api-resources/${resource.id}/permissions`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ scopeId: scope.id, key: 'contacts.read', tokenClaimValue: 'read' }),
      }),
      201,
      { key: 'contacts.read' },
    )
    const organization = await expectJson<OrganizationResponse>(
      await app.request('/api/admin/organizations', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ slug: 'acme-workspace', name: 'Acme Workspace' }),
      }),
      201,
      { slug: 'acme-workspace' },
    )
    const member = await expectJson<MemberResponse>(
      await app.request(`/api/admin/organizations/${organization.id}/members`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ userId: 'user-1', role: 'member' }),
      }),
      201,
      { userId: 'user-1', role: 'member' },
    )
    const role = await expectJson<RoleResponse>(
      await app.request('/api/admin/roles', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          key: 'contacts-reader',
          name: 'Contacts Reader',
          resourceId: resource.id,
          organizationId: organization.id,
          tokenClaimName: 'contacts_role',
        }),
      }),
      201,
      { key: 'contacts-reader' },
    )
    expect(
      await app.request(`/api/admin/roles/${role.id}/permissions`, {
        method: 'PUT',
        headers: adminHeaders(),
        body: JSON.stringify({ permissionIds: [permission.id] }),
      }),
    ).toMatchObject({ status: 204 })
    expect(
      await app.request('/api/admin/roles/assignments/members', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ roleId: role.id, subjectId: member.id, tokenClaims: { tier: 'gold' } }),
      }),
    ).toMatchObject({ status: 204 })

    await expectJson(
      await app.request('/api/admin/users', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ email: 'grace@example.com', password: 'password-1', displayName: 'Grace Hopper' }),
      }),
      201,
      { user: { id: 'user-2' } },
    )
    await expectJson(
      await app.request('/api/admin/users/user-2', {
        method: 'PATCH',
        headers: adminHeaders(),
        body: JSON.stringify({ displayName: 'Grace H.' }),
      }),
      200,
      { user: { id: 'user-2' } },
    )
    await expectJson(
      await app.request('/api/admin/users/user-2/ban', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ reason: 'security review' }),
      }),
      200,
      { user: { id: 'user-2', banned: true } },
    )
    await expectJson(
      await app.request('/api/admin/users/user-2/unban', { method: 'POST', headers: adminHeaders() }),
      200,
      { user: { id: 'user-2', banned: false } },
    )
    await expectJson(
      await app.request('/api/admin/users/password-reset', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ email: 'grace@example.com' }),
      }),
      200,
      { status: true },
    )

    await expectJson(
      await app.request('/api/account/profile', {
        method: 'PATCH',
        headers: userHeaders(),
        body: JSON.stringify({ displayName: 'User One', username: 'UserOne' }),
      }),
      200,
      { user: { id: 'user-1', username: 'userone' } },
    )
    await expectJson(
      await app.request('/api/account/security/mfa/totp-enrollment', {
        method: 'POST',
        headers: userHeaders(),
        body: JSON.stringify({ password: 'password-1' }),
      }),
      201,
      { mfa: { secret: 'totp-secret' } },
    )
    await expectJson(
      await app.request('/api/account/security/passkeys/registration-options', {
        method: 'POST',
        headers: userHeaders(),
        body: JSON.stringify({ name: 'Laptop' }),
      }),
      200,
      { challenge: 'passkey-challenge' },
    )

    await expectJson(
      await app.request('/api/management/connectors', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          providerType: 'generic_oauth',
          providerId: 'okta-main',
          displayName: 'Okta',
          clientId: 'okta-client',
          clientSecretBinding: 'secret://okta',
          authorizationEndpoint: 'https://idp.example.com/oauth2/v1/authorize',
          tokenEndpoint: 'https://idp.example.com/oauth2/v1/token',
          userInfoEndpoint: 'https://idp.example.com/oauth2/v1/userinfo',
        }),
      }),
      201,
      { providerId: 'okta-main', enabled: true },
    )

    const redirect = await app.request(`${authorizationUrl}&resource=https://api.example.com/contacts`, {
      headers: userHeaders(),
    })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('https://app.example.com/callback?code=code-1&state=state-1')
    const token = await expectJson<{ access_token: string; authorization: Record<string, unknown> }>(
      await app.request('/api/auth/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'code-1',
          client_id: client.clientId,
          client_secret: client.clientSecret,
          resource: 'https://api.example.com/contacts',
        }),
      }),
      200,
      {
        access_token: 'access-token-1',
        authorization: {
          roles: ['contacts-reader'],
          permissions: ['contacts.read'],
          organization_id: organization.id,
          resource: 'contacts-api',
          audience: 'https://api.example.com/contacts',
        },
      },
    )
    await expectJson(
      await app.request('/api/auth/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } }),
      200,
      { sub: 'user-1', email: 'user-1@example.com', name: 'User One' },
    )

    expect(auth.api.createUser).toHaveBeenCalled()
    expect(auth.api.adminUpdateUser).toHaveBeenCalledWith({
      body: {
        userId: 'user-2',
        data: { name: 'Grace H.' },
      },
      headers: expect.any(Headers),
    })
    expect(auth.api.banUser).toHaveBeenCalled()
    expect(auth.api.unbanUser).toHaveBeenCalled()
    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: 'grace@example.com',
        redirectTo: undefined,
      },
      headers: expect.any(Headers),
    })
    expect(releaseState.authorization?.buildTokenClaims).toHaveBeenCalledWith({
      userId: 'user-1',
      applicationId: 'app-1',
      organizationId: 'org-1',
      resource: 'https://api.example.com/contacts',
      scopes: ['openid', 'profile', 'email'],
    })
    expect(users.updateProfile).toHaveBeenCalledWith('user-1', { displayName: 'User One', username: 'userone' })
    expect(auth.api.enableTwoFactor).toHaveBeenCalled()
    expect(auth.api.generatePasskeyRegistrationOptions).toHaveBeenCalled()
    expect(connectors.create).toHaveBeenCalled()
  })
})

function createAuthDouble() {
  const api = {
    getOAuthServerConfig: vi.fn(),
    getOpenIdConfig: vi.fn(),
    getSession: vi.fn().mockImplementation(({ headers }: { headers: Headers }) => {
      const id = headers.get('x-user-id')
      if (!id) return null
      return {
        session: { id: 'session-1' },
        user: {
          id,
          email: `${id}@example.com`,
          name: id === 'user-1' ? 'User One' : 'Admin User',
          role: headers.get('x-user-role'),
        },
      }
    }),
    listUsers: vi.fn().mockResolvedValue({ users: [], total: 0 }),
    getUser: vi.fn().mockResolvedValue({ id: 'user-2' }),
    createUser: vi.fn().mockResolvedValue({ user: { id: 'user-2' } }),
    adminUpdateUser: vi.fn().mockResolvedValue({ id: 'user-2' }),
    banUser: vi.fn().mockResolvedValue({ user: { id: 'user-2', banned: true } }),
    unbanUser: vi.fn().mockResolvedValue({ user: { id: 'user-2', banned: false } }),
    removeUser: vi.fn().mockResolvedValue({ success: true }),
    requestPasswordReset: vi.fn().mockResolvedValue({ status: true }),
    sendVerificationEmail: vi.fn().mockResolvedValue({ status: true }),
    changeEmail: vi.fn().mockResolvedValue({ status: true }),
    changePassword: vi.fn().mockResolvedValue({ status: true }),
    linkSocialAccount: vi.fn().mockResolvedValue({ url: 'https://accounts.google.com/oauth' }),
    oAuth2LinkAccount: vi.fn().mockResolvedValue({ url: 'https://idp.example.com/oauth' }),
    unlinkAccount: vi.fn().mockResolvedValue({ success: true }),
    revokeUserSession: vi.fn().mockResolvedValue({ success: true }),
    revokeUserSessions: vi.fn().mockResolvedValue({ success: true }),
    revokeSession: vi.fn().mockResolvedValue({ success: true }),
    revokeSessions: vi.fn().mockResolvedValue({ success: true }),
    enableTwoFactor: vi.fn().mockResolvedValue({ mfa: { secret: 'totp-secret' } }),
    verifyTOTP: vi.fn().mockResolvedValue({ success: true }),
    disableTwoFactor: vi.fn().mockResolvedValue({ success: true }),
    generatePasskeyRegistrationOptions: vi.fn().mockResolvedValue({ challenge: 'passkey-challenge' }),
    verifyPasskeyRegistration: vi.fn().mockResolvedValue({ verified: true }),
  }

  return {
    api,
    handler: async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/api/auth/sign-in/email') {
        return Response.json(
          { user: { id: 'user-1', email: 'user-1@example.com' } },
          {
            headers: { 'set-cookie': 'flareauth.session=session-1; Path=/; HttpOnly' },
          },
        )
      }
      if (url.pathname === '/api/auth/oauth2/authorize') {
        if (!request.headers.get('x-user-id')) return Response.redirect(`${url.origin}/sign-in`, 302)
        const redirectUri = new URL(url.searchParams.get('redirect_uri') ?? '')
        redirectUri.searchParams.set('code', 'code-1')
        redirectUri.searchParams.set('state', url.searchParams.get('state') ?? '')
        return Response.redirect(redirectUri, 302)
      }
      if (url.pathname === '/api/auth/oauth2/token') {
        const body = await request.formData()
        const claims = await releaseState.authorization?.buildTokenClaims({
          userId: 'user-1',
          applicationId: 'app-1',
          organizationId: 'org-1',
          resource: body.get('resource')?.toString(),
          scopes: ['openid', 'profile', 'email'],
        })
        return Response.json({
          access_token: 'access-token-1',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email',
          authorization: claims?.authorization,
        })
      }
      if (url.pathname === '/api/auth/userinfo') {
        if (request.headers.get('authorization') !== 'Bearer access-token-1') {
          return Response.json({ error: 'invalid_token' }, { status: 401 })
        }
        return Response.json({ sub: 'user-1', email: 'user-1@example.com', name: 'User One' })
      }
      return new Response(null, { status: 204 })
    },
  }
}

function createOnboardingRepositoryDouble() {
  let hasUsers = false
  return {
    hasUsers: vi.fn(async () => hasUsers),
    createBootstrapAdmin: vi.fn(async () => {
      hasUsers = true
      return { id: 'admin-1', email: 'admin@example.com', role: 'admin' }
    }),
  }
}

function createApplicationServiceDouble() {
  let consent: { id: string; scopes: string[]; grantedAt: string } | null = null
  const application: ApplicationResponse & { clientSecret: string } = {
    id: 'app-1',
    slug: 'acme-portal',
    name: 'Acme Portal',
    description: null,
    homepageUrl: null,
    iconUrl: null,
    clientId: 'client-1',
    clientSecret: 'secret-1',
    clientType: 'confidential_web',
    public: false,
    firstParty: false,
    trusted: true,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://app.example.com/callback'],
    allowedGrantTypes: ['authorization_code', 'refresh_token'],
    allowedScopes: ['openid', 'profile', 'email'],
    requirePkce: false,
    tokenEndpointAuthMethod: 'client_secret_basic',
    secretMetadata: [
      {
        id: 'secret-1',
        version: 1,
        prefix: 'fas_secret_1',
        status: 'active',
        createdAt: now(),
        expiresAt: null,
        revokedAt: null,
      },
    ],
    oidc: {
      issuer: 'https://auth.example.com/api/auth',
      authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwksUri: 'https://auth.example.com/api/auth/jwks',
      userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
    },
    createdAt: now(),
    updatedAt: now(),
  }

  return {
    create: vi.fn(async () => application),
    list: vi.fn(async () => ({ applications: [application], pagination: page(1) })),
    get: vi.fn(async () => application),
    loadConsentRequest: vi.fn(async (input: { scope?: string; state?: string }) => ({
      application,
      requestedScopes: input.scope?.split(' ') ?? ['openid'],
      existingConsent: consent,
      state: input.state ?? null,
    })),
    createConsent: vi.fn(async (input: Pick<CreateConsentRequest, 'clientId' | 'scopes'>) => {
      consent = { id: 'consent-1', scopes: input.scopes, grantedAt: now() }
      return consent
    }),
  }
}

function createAuthorizationServiceDouble() {
  const resource: ApiResourceResponse = {
    id: 'res-1',
    identifier: 'contacts-api',
    name: 'Contacts API',
    audience: 'https://api.example.com/contacts',
    description: null,
    enabled: true,
    tokenClaimsNamespace: 'https://claims.example.com/contacts',
    createdAt: now(),
    updatedAt: now(),
  }
  const scope: ApiScopeResponse = {
    id: 'scope-1',
    resourceId: resource.id,
    value: 'contacts:read',
    description: null,
    required: false,
    tokenClaimName: null,
    includeInAccessToken: true,
    includeInIdToken: false,
  }
  const permission: ApiPermissionResponse = {
    id: 'perm-1',
    resourceId: resource.id,
    scopeId: scope.id,
    key: 'contacts.read',
    description: null,
    tokenClaimValue: 'read',
  }
  const organization: OrganizationResponse = {
    id: 'org-1',
    slug: 'acme-workspace',
    name: 'Acme Workspace',
    displayName: null,
    logo: null,
    disabled: false,
    disabledReason: null,
    createdAt: now(),
    updatedAt: now(),
  }
  const member: MemberResponse = {
    id: 'mem-1',
    organizationId: organization.id,
    userId: 'user-1',
    role: 'member',
    title: null,
    createdAt: now(),
    updatedAt: now(),
  }
  const role: RoleResponse = {
    id: 'role-1',
    key: 'contacts-reader',
    name: 'Contacts Reader',
    description: null,
    resourceId: resource.id,
    organizationId: organization.id,
    applicationId: null,
    system: false,
    tokenClaimName: 'contacts_role',
    tokenClaimValue: null,
    createdAt: now(),
    updatedAt: now(),
  }
  let assignment: AssignRoleRequest | null = null

  return {
    createOrganization: vi.fn(async () => organization),
    listOrganizations: vi.fn(async () => ({ organizations: [organization], pagination: page(1) })),
    addMember: vi.fn(async () => member),
    createResource: vi.fn(async () => resource),
    createScope: vi.fn(async () => scope),
    createPermission: vi.fn(async () => permission),
    createRole: vi.fn(async () => role),
    replaceRolePermissions: vi.fn(async () => undefined),
    assignMemberRole: vi.fn(async (input: AssignRoleRequest) => {
      assignment = input
    }),
    assignApplicationRole: vi.fn(async () => undefined),
    buildTokenClaims: vi.fn(
      async (_input: {
        userId?: string | null
        applicationId?: string | null
        organizationId?: string
        resource?: string
        scopes: string[]
      }) => ({
        authorization: {
          scopes: ['openid', 'profile', 'email'],
          roles: assignment ? [role.key] : [],
          permissions: assignment ? [permission.key] : [],
          organization_id: organization.id,
          resource: resource.identifier,
          audience: resource.audience,
        },
        roles: assignment ? [role.key] : [],
        permissions: assignment ? [permission.key] : [],
        tier: assignment?.tokenClaims?.tier,
        'https://claims.example.com/contacts': {
          contacts_role: role.key,
        },
      }),
    ),
  }
}

function createUserRepositoryDouble(): UserRepository {
  const profile = {
    id: 'user-1',
    email: 'user-1@example.com',
    emailVerified: true,
    displayName: 'User One',
    username: 'userone',
    avatarAssetId: null,
    image: null,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: new Date(now()),
    updatedAt: new Date(now()),
  }
  return {
    getUser: vi.fn().mockResolvedValue(profile),
    updateProfile: vi.fn().mockResolvedValue(profile),
    assertAccountAvatarReference: vi.fn().mockResolvedValue(undefined),
    assertAdminAvatarReference: vi.fn().mockResolvedValue(undefined),
    listLinkedAccounts: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    listConsentedApplications: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    listSessions: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

function createSecurityRepositoryDouble() {
  return {
    getSecurityState: vi.fn().mockResolvedValue({
      userId: 'user-1',
      mfa: { enabled: false, factors: [] },
      passkeys: { enabled: true, count: 0 },
      policy: securityPolicy(),
    }),
    listPasskeys: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    deletePasskey: vi.fn().mockResolvedValue(undefined),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

function createConnectorServiceDouble() {
  const connector = {
    id: 'connector-1',
    slug: 'okta-main',
    providerType: 'generic_oauth',
    providerId: 'okta-main',
    displayName: 'Okta',
    enabled: true,
    clientId: 'okta-client',
    clientSecretBinding: 'secret://okta',
    issuer: null,
    authorizationEndpoint: 'https://idp.example.com/oauth2/v1/authorize',
    tokenEndpoint: 'https://idp.example.com/oauth2/v1/token',
    userInfoEndpoint: 'https://idp.example.com/oauth2/v1/userinfo',
    jwksEndpoint: null,
    scopes: [],
    providerMetadata: {},
    createdAt: now(),
    updatedAt: now(),
  }

  return {
    list: vi.fn().mockResolvedValue({ connectors: [], pagination: page(0) }),
    create: vi.fn().mockResolvedValue(connector),
    get: vi.fn().mockResolvedValue(connector),
    update: vi.fn().mockResolvedValue(connector),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

async function expectJson<T>(response: Response, status: number, expected: unknown): Promise<T> {
  expect(response.status).toBe(status)
  const body = (await response.json()) as T
  expect(body).toMatchObject(expected as object)
  return body
}

function adminHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': 'admin-1',
    'x-user-role': 'admin',
  }
}

function userHeaders() {
  return {
    'content-type': 'application/json',
    'x-user-id': 'user-1',
    'x-user-role': 'user',
  }
}

function securityPolicy(): SecurityPolicy {
  return {
    mfa: { mode: 'optional' },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'FlareAuth',
      origins: ['https://auth.example.com'],
    },
    sessions: {
      expiresInSeconds: 3600,
      updateAgeSeconds: 300,
      freshAgeSeconds: 600,
      cookieCacheSeconds: 60,
    },
  }
}

function page(total: number) {
  return {
    limit: 50,
    offset: 0,
    total,
    hasMore: false,
    nextOffset: null,
  }
}

function now() {
  return '2026-05-18T12:00:00.000Z'
}

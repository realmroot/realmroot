export const pagination = {
  limit: 50,
  offset: 0,
  total: 1,
  hasMore: false,
  nextOffset: null,
}

export const emptyPagination = {
  ...pagination,
  total: 0,
}

export const webhookEndpoint = {
  id: 'wh_1',
  url: 'https://app.example.com/webhooks/auth',
  events: ['user.created', 'session.revoked'],
  enabled: true,
  organizationId: null,
  secretPrefix: 'whsec_abcd123',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const webhookRequest = {
  id: 'whr_1',
  endpointId: 'wh_1',
  endpointUrl: 'https://app.example.com/webhooks/auth',
  organizationId: null,
  event: 'user.created',
  status: 'failed',
  attemptCount: 1,
  httpStatus: 500,
  error: 'Server error',
  requestBody: '{"id":"user-1"}',
  responseBody: '{"error":"failed"}',
  nextAttemptAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const application = {
  id: 'app-1',
  slug: 'customer-portal',
  name: 'Customer portal',
  description: null,
  homepageUrl: null,
  iconUrl: null,
  clientId: 'client-1',
  clientType: 'public_spa',
  public: true,
  consentRequired: false,
  disabled: false,
  disabledReason: null,
  ownerOrganizationId: 'org-1',
  redirectUris: ['https://app.example.com/callback'],
  postLogoutRedirectUris: ['https://app.example.com/signed-out'],
  corsOrigins: ['https://app.example.com'],
  customData: { plan: 'enterprise' },
  allowedGrantTypes: ['authorization_code', 'refresh_token'],
  oidcScopes: ['openid', 'profile', 'email', 'offline_access'],
  resourceScopes: [],
  requirePkce: true,
  tokenEndpointAuthMethod: 'none',
  secretMetadata: [],
  oidc: {
    issuer: 'https://auth.example.com',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    jwksUri: 'https://auth.example.com/jwks',
    userInfoEndpoint: 'https://auth.example.com/userinfo',
    endSessionEndpoint: 'https://auth.example.com/logout',
  },
  oidcClaims: {
    accessToken: {
      authorization: true,
      roles: true,
      groups: true,
    },
    idToken: {},
    userInfo: {},
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const user = {
  id: 'user-1',
  email: 'jane@example.com',
  name: 'Jane Doe',
  role: 'admin',
  banned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const profile = {
  id: 'user-1',
  email: 'jane@example.com',
  emailVerified: true,
  displayName: 'Jane Stone',
  username: 'jane',
  avatarAssetId: null,
  image: null,
}

export const consoleAccountProfile = {
  ...profile,
  role: 'admin',
}

export const consoleAccountAccess = {
  canCreateOrganization: true,
  showOrganizations: true,
  platformOperator: true,
  consoleOrganizations: [],
}

export const connector = {
  id: 'connector-1',
  providerId: 'google',
  providerType: 'social',
  slug: 'google',
  displayName: 'Google',
  enabled: true,
  capabilities: { authentication: true, resourceAuthorization: false },
  authenticationEnabled: true,
  clientId: 'google-client',
  clientSecretConfigured: true,
  issuer: 'https://accounts.google.com',
  authorizationEndpoint: null,
  tokenEndpoint: null,
  userInfoEndpoint: null,
  jwksEndpoint: null,
  registrationEndpoint: null,
  revocationEndpoint: null,
  registrationMode: null,
  scopes: ['openid', 'email'],
  providerMetadata: { prompt: 'select_account' },
  resourceAuthorization: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const connectorTemplates = {
  items: [
    {
      providerType: 'social',
      providerId: 'google',
      displayName: 'Google',
      icon: 'google',
      capabilities: { authentication: true, resourceAuthorization: false },
      requiredFields: ['clientId', 'clientSecret'],
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
    {
      providerType: 'social',
      providerId: 'cognito',
      displayName: 'Amazon Cognito',
      icon: 'cognito',
      capabilities: { authentication: true, resourceAuthorization: false },
      requiredFields: [
        'clientId',
        'clientSecret',
        'providerMetadata.domain',
        'providerMetadata.region',
        'providerMetadata.userPoolId',
      ],
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
    {
      providerType: 'social',
      providerId: 'github',
      displayName: 'GitHub',
      icon: 'github',
      capabilities: { authentication: true, resourceAuthorization: true },
      requiredFields: ['clientId', 'clientSecret'],
      optionalFields: ['scopes'],
      defaultScopes: ['read:user', 'user:email'],
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

export const organization = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme',
  displayName: 'Acme Inc.',
  logo: null,
  metadata: null,
  disabled: false,
  disabledReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const uploadedAsset = {
  id: 'asset-1',
  purpose: 'application_logo',
  publicUrl: 'https://auth.example.com/api/assets/asset-1',
  contentType: 'image/png',
  byteSize: 6,
  checksumSha256: 'checksum-1',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const role = {
  key: 'admin',
  displayName: 'Admin',
  description: 'Tenant administrator',
  predefined: true,
  scopes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const apiResource = {
  id: 'resource-1',
  identifier: 'management-api',
  name: 'Management API',
  description: 'Management surface',
  resourceUrl: 'https://auth.example.com/api',
  authorizationModel: 'native' as const,
  connectorId: null,
  authorizationDetails: [],
  enabled: true,
  ownerOrganizationId: 'org-1',
  visibility: 'public' as const,
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://auth.example.com/openapi.json',
      etag: null,
      documentHash: 'fixture',
      syncedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
    },
    scopes: [],
  },
  availableToAgents: true,
  authorization: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  availability: { status: 'available' as const, checkedAt: '2026-01-01T00:00:00.000Z' },
  scopes: [],
  connection: null,
  links: {
    self: 'https://auth.example.com/api/resource-servers/resource-1',
    authorizationDetails: 'https://auth.example.com/api/resource-servers/resource-1/authorization-details',
  },
}

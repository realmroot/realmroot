import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'
import { getAddress } from 'viem'
import type {
  AccountAgentsResponse,
  AccountEmailChangeConfirmInput,
  AccountEmailChangeInput,
  AccountPasswordChangeInput,
  AccountProfileResponse,
  AccountProfileUpdateInput,
  AccountSecurityResponse,
  AccountSessionsResponse,
  AccountWalletAddressLinkInput,
  ConsentedApplicationsResponse,
  LinkedAccountsResponse,
} from '../shared/api/account'
import type {
  ApplicationResponse,
  ConsentApprovalResponse,
  ConsentRequestResponse,
  CreateApplicationRequest,
  CreateApplicationResponse,
  HostedConsentApprovalRequest,
  ListApplicationsResponse,
  ListClientSecretsResponse,
  ListRedirectUrisResponse,
  PaginationQuery,
  ReplaceRedirectUrisRequest,
  RotateClientSecretResponse,
  UpdateApplicationRequest,
} from '../shared/api/applications'
import type {
  ApiPermissionResponse,
  ApiResourceResponse,
  ApiScopeResponse,
  AssignRoleRequest,
  CreateApiPermissionRequest,
  CreateApiResourceRequest,
  CreateApiScopeRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  ListApiPermissionsResponse,
  ListApiResourcesResponse,
  ListApiScopesResponse,
  ListOrganizationsResponse,
  ListRolesResponse,
  OrganizationResponse,
  RolePermissionsResponse,
  RoleResponse,
  UpdateApiPermissionRequest,
  UpdateApiResourceRequest,
  UpdateApiScopeRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '../shared/api/authorization'
import type { ConfigzConfigResponse } from '../shared/api/configz'
import type {
  ConnectorReadinessResponse,
  LinkAccountRequest,
  ListConnectorTemplatesResponse,
} from '../shared/api/connectors'
import type {
  CreateManagementConnectorRequest,
  ListManagementConnectorsResponse,
  ListManagementUserApplicationsResponse,
  ListManagementUserLinkedAccountsResponse,
  ListManagementUserPasskeysResponse,
  ListManagementUserSessionsResponse,
  ListManagementUsersResponse,
  ManagementAccountCenterSettingsResponse,
  ManagementAgentInventoryResponse,
  ManagementBanUserRequest,
  ManagementBrandingSettingsResponse,
  ManagementConnectorResponse,
  ManagementCreateUserRequest,
  ManagementReadinessResponse,
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserDetailResponse,
  ManagementUserListQuery,
  ManagementUserResponse,
  ManagementUserSecurityResponse,
  UpdateManagementAccountCenterSettingsRequest,
  UpdateManagementBrandingSettingsRequest,
  UpdateManagementConnectorRequest,
  UpdateManagementSignInSettingsRequest,
} from '../shared/api/management'
import type {
  PasskeysResponse,
  SecurityPolicy,
  SecurityTotpDisableInput,
  SecurityTotpEnrollmentInput,
  SecurityTotpVerificationInput,
  UpdateSecurityPolicyInput,
} from '../shared/api/security'
import type {
  CreateWebhookEndpointRequest,
  ListWebhookEndpointsQuery,
  ListWebhookEndpointsResponse,
  ListWebhookRequestsQuery,
  ListWebhookRequestsResponse,
  UpdateWebhookEndpointRequest,
  WebhookEndpoint,
  WebhookEndpointSecretResponse,
  WebhookRequest,
} from '../shared/api/webhooks'
import type { Auth } from './auth'
import { forbidden, handleApiError, notFound } from './lib/errors'
import { accessLog } from './middleware/access-log'
import { authContext, managementBearerAuth, type SessionReader } from './middleware/auth-context'
import { trustedOriginCors } from './middleware/cors'
import { requestContext } from './middleware/request-context'
import { requireSecurityPolicy } from './middleware/security-policy'
import { createApplicationService } from './modules/applications/context'
import type { ConfigzBindings } from './modules/configz/context'
import type { OnboardingRepository } from './modules/onboarding/repository'
import type { SecurityRepository } from './modules/security/repository'
import type { UserRepository } from './modules/users/repository'
import type { WalletRepository } from './modules/wallets/repository'
import { managementOpenApiForRequest, managementOpenApiLinkHeader, managementOpenApiPath } from './openapi/management'
import { accountRoutes } from './routes/account'
import { adminAgentsRoute } from './routes/admin/agents'
import { adminApiResourcesRoute } from './routes/admin/api-resources'
import { adminApplicationsRoute } from './routes/admin/applications'
import { adminConnectorsRoute } from './routes/admin/connectors'
import { adminOrganizationsRoute } from './routes/admin/organizations'
import { adminRolesRoute } from './routes/admin/roles'
import { adminSecurityRoutes } from './routes/admin/security'
import { adminUserRoutes } from './routes/admin/users'
import {
  type AssetServiceFactory,
  createAccountAssetRoutes,
  createAssetRoutes,
  createManagementAssetRoutes,
} from './routes/assets'
import type { ManagementAuthApi } from './routes/auth-api'
import { type ConfigzServiceFactory, createConfigzRoutes } from './routes/configz'
import {
  createManagementRoutes,
  type ManagementApplicationServiceFactory,
  type ManagementConfigzServiceFactory,
} from './routes/management'
import type { ConnectorServiceFactory } from './routes/management/connectors'
import type { WebhookServiceFactory } from './routes/management/webhooks'
import { oauthConsentRoute } from './routes/oauth/consent'
import { onboardingRoutes } from './routes/onboarding'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getAgentConfiguration?: (context: { request: Request; asResponse: false }) => Promise<AgentConfiguration>
  } & SessionReader['api']
}

type AgentConfiguration = {
  issuer: string
  default_location: string
  endpoints: Record<string, string>
  [key: string]: unknown
}

export interface AppOptions {
  trustedOrigins?: string[]
  userRepository?: UserRepository
  securityRepository?: SecurityRepository
  walletRepository?: WalletRepository
  onboardingRepository?: OnboardingRepository
  securityPolicy?: SecurityPolicy
  configzServiceFactory?: ConfigzServiceFactory & ManagementConfigzServiceFactory
  applicationServiceFactory?: ManagementApplicationServiceFactory
  connectorServiceFactory?: ConnectorServiceFactory
  webhookServiceFactory?: WebhookServiceFactory
  assetServiceFactory?: AssetServiceFactory
}

interface RpcAppOptions extends AppOptions {
  userRepository: UserRepository
  securityRepository: SecurityRepository
  securityPolicy: SecurityPolicy
}

export function createApp(auth: AuthHandler, options: AppOptions = {}) {
  const app = new Hono()

  app.use('*', requestContext())
  app.use('*', accessLog())
  app.use(
    '/api/*',
    trustedOriginCors(options.trustedOrigins ?? [], { resolveAllowedOrigins: oauthClientCorsOrigins(options) }),
  )
  app.use('/api/*', authContext(auth))

  if (options.securityRepository) {
    app.use('/api/*', requireSecurityPolicy(options.securityRepository))
  }

  app.onError((error, c) => handleApiError(error, c))
  app.notFound((c) => handleApiError(notFound(), c))

  if (options.userRepository && options.securityRepository && options.securityPolicy) {
    mountRpcRoutes(app, auth, {
      ...options,
      userRepository: options.userRepository,
      securityRepository: options.securityRepository,
      securityPolicy: options.securityPolicy,
    })
  } else {
    mountCoreApiRoutes(app, auth, options)

    if (options.userRepository) {
      const managementApi = auth.api as unknown as ManagementAuthApi
      app.route(
        '/api/admin/users',
        adminUserRoutes(managementApi, options.userRepository, { securityRepository: options.securityRepository }),
      )
      app.route(
        '/api/account',
        accountRoutes(
          managementApi,
          options.userRepository,
          options.securityRepository,
          options.applicationServiceFactory,
          options.configzServiceFactory,
          options.walletRepository,
        ),
      )
      app.route(
        '/api/account',
        createAccountAssetRoutes(
          options.assetServiceFactory,
          options.configzServiceFactory
            ? async (c) =>
                (
                  await options.configzServiceFactory!(
                    c as unknown as Context<{ Bindings: ConfigzBindings }>,
                  ).getConfig()
                ).accountCenter
            : undefined,
        ),
      )
    }
  }

  app.get('/api/auth/.well-known/openid-configuration', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.get('/.well-known/openid-configuration/api/auth', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.get('/.well-known/agent-configuration', (c) => {
    if (!auth.api.getAgentConfiguration) throw notFound('Agent configuration is not available.')
    return auth.api
      .getAgentConfiguration({ request: c.req.raw, asResponse: false })
      .then((configuration) => c.json(mountAgentConfiguration(configuration)))
  })
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    if (options.onboardingRepository) {
      await requireOnboardingComplete(options.onboardingRepository)
    }
    if (options.configzServiceFactory) {
      await requireHostedAuthMethodEnabled(c, options.configzServiceFactory)
    }
    if (options.walletRepository) {
      await requireLinkedSiweWallet(c, options.walletRepository)
    }

    return auth.handler(c.req.raw)
  })
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) => oauthProviderAuthServerMetadata(auth)(c.req.raw))

  return app
}

function mountAgentConfiguration(configuration: AgentConfiguration): AgentConfiguration {
  const issuer = mountAgentIssuer(configuration.issuer)
  return {
    ...configuration,
    issuer,
    default_location: mountAgentUrl(configuration.default_location, issuer),
    endpoints: Object.fromEntries(
      Object.entries(configuration.endpoints).map(([key, value]) => [key, mountAgentUrl(value, issuer)]),
    ),
  }
}

function mountAgentIssuer(issuer: string) {
  const url = new URL(issuer)
  if (url.pathname === '/api/auth' || url.pathname.endsWith('/api/auth')) return issuer
  return `${issuer.replace(/\/$/, '')}/api/auth`
}

function mountAgentUrl(value: string, issuer: string) {
  const url = new URL(value)
  const path = url.pathname.startsWith('/api/auth/') ? url.pathname.slice('/api/auth'.length) : url.pathname
  return `${issuer}${path}${url.search}`
}

function oauthClientCorsOrigins(options: AppOptions) {
  return async ({ path, context }: { path: string; context: Context }) => {
    if (!isOAuthClientCorsPath(path)) return []

    const serviceFactory = options.applicationServiceFactory ?? createApplicationService
    const origins = new Set<string>()
    let offset = 0

    for (;;) {
      const result = await serviceFactory(context as never).list({
        limit: 100,
        offset,
      })
      for (const application of result.applications) {
        if (application.disabled) continue
        for (const origin of application.corsOrigins) origins.add(origin)
      }
      if (!result.pagination.hasMore || result.pagination.nextOffset === null) break
      offset = result.pagination.nextOffset
    }

    return [...origins]
  }
}

function isOAuthClientCorsPath(path: string) {
  return oauthClientCorsPaths.has(path)
}

const oauthClientCorsPaths = new Set([
  '/api/auth/.well-known/openid-configuration',
  '/api/auth/.well-known/oauth-authorization-server',
  '/api/auth/jwks',
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/userinfo',
  '/api/auth/oauth2/revoke',
  '/api/auth/oauth2/introspect',
])

async function requireHostedAuthMethodEnabled(c: Context, factory: ConfigzServiceFactory) {
  const path = c.req.path
  if (!isManagedHostedAuthPath(path)) return

  const config = await factory(c as unknown as Context<{ Bindings: ConfigzBindings }>).getConfig()
  if (!config.signIn.passwordEnabled && passwordAuthPaths.has(path)) {
    throw forbidden('Password authentication is disabled.')
  }
  if (!config.signIn.signupEnabled && path === '/api/auth/sign-up/email') {
    throw forbidden('Sign up is disabled.')
  }
  if (!config.signIn.emailOtpEnabled && (emailOtpAuthPaths.has(path) || (await isBlockedEmailOtpRequest(c)))) {
    throw forbidden('Email code authentication is disabled.')
  }
  if (!config.signIn.socialLoginEnabled && path === '/api/auth/sign-in/social') {
    throw forbidden('Social authentication is disabled.')
  }
  if (web3WalletAuthPaths.has(path) && !config.builtInProviders.web3Wallet.enabled) {
    throw forbidden('Web3 wallet authentication is disabled.')
  }
}

const passwordAuthPaths = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-in/username',
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/email-otp/request-password-reset',
  '/api/auth/email-otp/reset-password',
  '/api/auth/change-password',
])

const emailOtpAuthPaths = new Set(['/api/auth/sign-in/email-otp'])
const web3WalletAuthPaths = new Set(['/api/auth/siwe/nonce', '/api/auth/siwe/get-nonce', '/api/auth/siwe/verify'])

function isManagedHostedAuthPath(path: string) {
  return (
    passwordAuthPaths.has(path) ||
    emailOtpAuthPaths.has(path) ||
    web3WalletAuthPaths.has(path) ||
    path === '/api/auth/email-otp/send-verification-otp' ||
    path === '/api/auth/sign-in/social'
  )
}

async function requireLinkedSiweWallet(c: Context, wallets: WalletRepository) {
  if (c.req.path !== '/api/auth/siwe/verify') return

  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null)
  if (!body || typeof body !== 'object') return

  const record = body as Record<string, unknown>
  const walletAddress = typeof record.walletAddress === 'string' ? toWalletAddress(record.walletAddress) : null
  const chainId = typeof record.chainId === 'number' ? record.chainId : 1
  if (!walletAddress) return

  const linked = await wallets.findWalletAddress(walletAddress, chainId)
  const linkedOnAnotherChain = linked ? null : await wallets.findAnyWalletAddress(walletAddress)
  if (!linked && !linkedOnAnotherChain) {
    throw forbidden('This wallet is not linked to an existing account.')
  }
}

function toWalletAddress(value: string) {
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

async function isBlockedEmailOtpRequest(c: Context) {
  if (c.req.path !== '/api/auth/email-otp/send-verification-otp') return false

  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null)
  return !(body && typeof body === 'object' && 'type' in body && body.type === 'email-verification')
}

export function createRpcApp(auth: AuthHandler, options: RpcAppOptions) {
  return mountRpcRoutes(new Hono(), auth, options) as Hono<object, RpcSchema>
}

export type AppType = ReturnType<typeof createRpcApp>

type EmptyResponse = Record<string, unknown>
type RpcNoInput = Record<never, never>
type RpcEndpoint<Input, Output, Status extends StatusCode = ContentfulStatusCode> = {
  input: Input
  output: Output
  outputFormat: 'json'
  status: Status
}

type RpcSchema = {
  '/api/health': {
    $get: RpcEndpoint<RpcNoInput, { ok: true; service: string }>
  }
  '/api/configz': {
    $get: RpcEndpoint<RpcNoInput, ConfigzConfigResponse>
  }
  '/api/oauth/consent': {
    $get: RpcEndpoint<
      { query: { client_id: string; redirect_uri: string; scope?: string; state?: string } },
      ConsentRequestResponse
    >
    $post: RpcEndpoint<{ json: HostedConsentApprovalRequest }, ConsentApprovalResponse, 201>
  }
  '/api/account/profile': {
    $get: RpcEndpoint<RpcNoInput, AccountProfileResponse>
    $patch: RpcEndpoint<{ json: AccountProfileUpdateInput }, AccountProfileResponse>
  }
  '/api/account/email/change': {
    $post: RpcEndpoint<{ json: AccountEmailChangeInput }, EmptyResponse>
  }
  '/api/account/email/confirm': {
    $post: RpcEndpoint<{ json: AccountEmailChangeConfirmInput }, EmptyResponse>
  }
  '/api/account/password/change': {
    $post: RpcEndpoint<{ json: AccountPasswordChangeInput }, EmptyResponse>
  }
  '/api/account/wallet-addresses': {
    $post: RpcEndpoint<{ json: AccountWalletAddressLinkInput }, EmptyResponse, 201>
  }
  '/api/account/wallet-addresses/:accountId': {
    $delete: RpcEndpoint<{ param: { accountId: string } }, EmptyResponse, 204>
  }
  '/api/account/linked-accounts': {
    $get: RpcEndpoint<RpcNoInput, LinkedAccountsResponse>
    $post: RpcEndpoint<{ json: LinkAccountRequest }, EmptyResponse>
  }
  '/api/account/linked-accounts/:providerId': {
    $delete: RpcEndpoint<{ param: { providerId: string }; query: { accountId: string } }, EmptyResponse>
  }
  '/api/account/applications': {
    $get: RpcEndpoint<RpcNoInput, ConsentedApplicationsResponse>
  }
  '/api/account/applications/:consentId': {
    $delete: RpcEndpoint<{ param: { consentId: string } }, EmptyResponse, 204>
  }
  '/api/account/sessions': {
    $get: RpcEndpoint<RpcNoInput, AccountSessionsResponse>
  }
  '/api/account/agents': {
    $get: RpcEndpoint<{ query?: Partial<Record<keyof PaginationQuery, string>> }, AccountAgentsResponse>
  }
  '/api/account/agents/:agentId': {
    $delete: RpcEndpoint<{ param: { agentId: string } }, EmptyResponse, 204>
  }
  '/api/account/agent-capability-grants/:grantId': {
    $delete: RpcEndpoint<{ param: { grantId: string } }, EmptyResponse, 204>
  }
  '/api/account/security': {
    $get: RpcEndpoint<RpcNoInput, AccountSecurityResponse>
  }
  '/api/account/security/mfa/totp-enrollment': {
    $post: RpcEndpoint<{ json: SecurityTotpEnrollmentInput }, EmptyResponse, 201>
  }
  '/api/account/security/mfa/totp-verification': {
    $post: RpcEndpoint<{ json: SecurityTotpVerificationInput }, EmptyResponse>
  }
  '/api/account/security/mfa/totp': {
    $delete: RpcEndpoint<{ json: SecurityTotpDisableInput }, EmptyResponse>
  }
  '/api/account/security/passkeys': {
    $get: RpcEndpoint<RpcNoInput, PasskeysResponse>
  }
  '/api/account/security/passkeys/:id': {
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/account/security/sessions': {
    $delete: RpcEndpoint<RpcNoInput, EmptyResponse>
  }
  '/api/account/security/sessions/:sessionId': {
    $delete: RpcEndpoint<{ param: { sessionId: string } }, EmptyResponse>
  }
  '/api/management/applications': {
    $get: RpcEndpoint<RpcNoInput, ListApplicationsResponse>
    $post: RpcEndpoint<{ json: CreateApplicationRequest }, CreateApplicationResponse, 201>
  }
  '/api/management/applications/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ApplicationResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateApplicationRequest }, ApplicationResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/management/applications/:id/redirect-uris': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListRedirectUrisResponse
    >
    $put: RpcEndpoint<{ param: { id: string }; json: ReplaceRedirectUrisRequest }, { redirectUris: string[] }>
  }
  '/api/management/applications/:id/client-secrets': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListClientSecretsResponse
    >
    $post: RpcEndpoint<{ param: { id: string } }, RotateClientSecretResponse, 201>
  }
  '/api/management/users': {
    $get: RpcEndpoint<{ query: Partial<Record<keyof ManagementUserListQuery, string>> }, ListManagementUsersResponse>
    $post: RpcEndpoint<{ json: ManagementCreateUserRequest }, EmptyResponse, 201>
  }
  '/api/management/users/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ManagementUserDetailResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: ManagementUpdateUserRequest }, { user: ManagementUserResponse }>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/management/users/password-reset-requests': {
    $post: RpcEndpoint<{ json: { email: string } }, EmptyResponse>
  }
  '/api/management/users/:id/password-reset-requests': {
    $post: RpcEndpoint<{ param: { id: string }; json: { redirectTo?: string } }, EmptyResponse>
  }
  '/api/management/users/:id/ban': {
    $put: RpcEndpoint<{ param: { id: string }; json: ManagementBanUserRequest }, EmptyResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/management/users/:id/sessions': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListManagementUserSessionsResponse
    >
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/management/users/:id/sessions/:sessionId': {
    $delete: RpcEndpoint<{ param: { id: string; sessionId: string } }, EmptyResponse>
  }
  '/api/management/users/:id/linked-accounts': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListManagementUserLinkedAccountsResponse
    >
  }
  '/api/management/users/:id/applications': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListManagementUserApplicationsResponse
    >
  }
  '/api/management/users/:id/security': {
    $get: RpcEndpoint<{ param: { id: string } }, ManagementUserSecurityResponse>
  }
  '/api/management/users/:id/passkeys': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListManagementUserPasskeysResponse
    >
  }
  '/api/management/users/:id/passkeys/:passkeyId': {
    $delete: RpcEndpoint<{ param: { id: string; passkeyId: string } }, EmptyResponse>
  }
  '/api/management/connectors': {
    $get: RpcEndpoint<RpcNoInput, ListManagementConnectorsResponse>
    $post: RpcEndpoint<{ json: CreateManagementConnectorRequest }, ManagementConnectorResponse, 201>
  }
  '/api/management/connectors/templates': {
    $get: RpcEndpoint<RpcNoInput, ListConnectorTemplatesResponse>
  }
  '/api/management/connectors/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ManagementConnectorResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateManagementConnectorRequest }, ManagementConnectorResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/management/connectors/:id/readiness': {
    $get: RpcEndpoint<{ param: { id: string } }, ConnectorReadinessResponse>
  }
  '/api/management/sign-in-settings': {
    $get: RpcEndpoint<RpcNoInput, ManagementSignInSettingsResponse>
    $patch: RpcEndpoint<{ json: UpdateManagementSignInSettingsRequest }, ManagementSignInSettingsResponse>
  }
  '/api/management/branding-settings': {
    $get: RpcEndpoint<RpcNoInput, ManagementBrandingSettingsResponse>
    $patch: RpcEndpoint<{ json: UpdateManagementBrandingSettingsRequest }, ManagementBrandingSettingsResponse>
  }
  '/api/management/webhooks/endpoints': {
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof ListWebhookEndpointsQuery, string>> },
      ListWebhookEndpointsResponse
    >
    $post: RpcEndpoint<{ json: CreateWebhookEndpointRequest }, WebhookEndpointSecretResponse, 201>
  }
  '/api/management/webhooks/endpoints/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, WebhookEndpoint>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateWebhookEndpointRequest }, WebhookEndpoint>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse, 204>
  }
  '/api/management/webhooks/endpoints/:id/secrets': {
    $post: RpcEndpoint<{ param: { id: string } }, WebhookEndpointSecretResponse, 201>
  }
  '/api/management/webhooks/requests': {
    $get: RpcEndpoint<{ query?: Partial<Record<keyof ListWebhookRequestsQuery, string>> }, ListWebhookRequestsResponse>
  }
  '/api/management/webhooks/requests/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, WebhookRequest>
  }
  '/api/management/webhooks/requests/:id/retries': {
    $post: RpcEndpoint<{ param: { id: string } }, WebhookRequest, 202>
  }
  '/api/management/account-center-settings': {
    $get: RpcEndpoint<RpcNoInput, ManagementAccountCenterSettingsResponse>
    $patch: RpcEndpoint<{ json: UpdateManagementAccountCenterSettingsRequest }, ManagementAccountCenterSettingsResponse>
  }
  '/api/management/readiness': {
    $get: RpcEndpoint<RpcNoInput, ManagementReadinessResponse>
  }
  '/api/management/agents/protocol-inventory': {
    $get: RpcEndpoint<{ query?: Partial<Record<keyof PaginationQuery, string>> }, ManagementAgentInventoryResponse>
  }
  '/api/management/agents/:agentId': {
    $delete: RpcEndpoint<{ param: { agentId: string } }, EmptyResponse, 204>
  }
  '/api/management/agent-hosts/:hostId': {
    $delete: RpcEndpoint<{ param: { hostId: string } }, EmptyResponse, 204>
  }
  '/api/management/agent-capability-grants/:grantId': {
    $delete: RpcEndpoint<{ param: { grantId: string } }, EmptyResponse, 204>
  }
  '/api/management/security/policy': {
    $get: RpcEndpoint<RpcNoInput, { policy: SecurityPolicy }>
    $patch: RpcEndpoint<{ json: UpdateSecurityPolicyInput }, { policy: SecurityPolicy }>
  }
  '/api/management/organizations': {
    $get: RpcEndpoint<RpcNoInput, ListOrganizationsResponse>
    $post: RpcEndpoint<{ json: CreateOrganizationRequest }, OrganizationResponse, 201>
  }
  '/api/management/organizations/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, OrganizationResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateOrganizationRequest }, OrganizationResponse>
  }
  '/api/management/roles': {
    $get: RpcEndpoint<RpcNoInput, ListRolesResponse>
    $post: RpcEndpoint<{ json: CreateRoleRequest }, RoleResponse, 201>
  }
  '/api/management/roles/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, RoleResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateRoleRequest }, RoleResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse, 204>
  }
  '/api/management/roles/:id/permissions': {
    $get: RpcEndpoint<{ param: { id: string } }, RolePermissionsResponse>
    $put: RpcEndpoint<{ param: { id: string }; json: { permissionIds: string[] } }, EmptyResponse, 204>
  }
  '/api/management/user-role-assignments': {
    $post: RpcEndpoint<{ json: AssignRoleRequest }, EmptyResponse, 204>
  }
  '/api/management/application-role-assignments': {
    $post: RpcEndpoint<{ json: AssignRoleRequest }, EmptyResponse, 204>
  }
  '/api/management/member-role-assignments': {
    $post: RpcEndpoint<{ json: AssignRoleRequest }, EmptyResponse, 204>
  }
  '/api/management/api-resources': {
    $get: RpcEndpoint<RpcNoInput, ListApiResourcesResponse>
    $post: RpcEndpoint<{ json: CreateApiResourceRequest }, ApiResourceResponse, 201>
  }
  '/api/management/api-resources/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ApiResourceResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateApiResourceRequest }, ApiResourceResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse, 204>
  }
  '/api/management/api-resources/:id/scopes': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListApiScopesResponse
    >
    $post: RpcEndpoint<{ param: { id: string }; json: CreateApiScopeRequest }, ApiScopeResponse, 201>
  }
  '/api/management/api-resources/:id/scopes/:scopeId': {
    $patch: RpcEndpoint<{ param: { id: string; scopeId: string }; json: UpdateApiScopeRequest }, ApiScopeResponse>
    $delete: RpcEndpoint<{ param: { id: string; scopeId: string } }, EmptyResponse, 204>
  }
  '/api/management/api-resources/:id/permissions': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListApiPermissionsResponse
    >
    $post: RpcEndpoint<{ param: { id: string }; json: CreateApiPermissionRequest }, ApiPermissionResponse, 201>
  }
  '/api/management/api-resources/:id/permissions/:permissionId': {
    $patch: RpcEndpoint<
      { param: { id: string; permissionId: string }; json: UpdateApiPermissionRequest },
      ApiPermissionResponse
    >
    $delete: RpcEndpoint<{ param: { id: string; permissionId: string } }, EmptyResponse, 204>
  }
}

function mountCoreApiRoutes(app: Hono, auth: AuthHandler, options: AppOptions) {
  const managementApi = auth.api as unknown as ManagementAuthApi
  let api = app
    .get('/api/health', (c) =>
      c.json({
        ok: true,
        service: 'flareauth',
      }),
    )
    .route('/api/admin/applications', adminApplicationsRoute)
    .route('/api/admin/agents', adminAgentsRoute)
    .route('/api/admin/api-resources', adminApiResourcesRoute)
    .route('/api/admin/connectors', adminConnectorsRoute)
    .route('/api/admin/organizations', adminOrganizationsRoute)
    .route('/api/admin/roles', adminRolesRoute)
    .route('/api/oauth/consent', oauthConsentRoute)
    .route(
      '/api/configz',
      createConfigzRoutes(options.configzServiceFactory, options.onboardingRepository, options.securityPolicy),
    )
    .route('/api/assets', createAssetRoutes(options.assetServiceFactory))
    .use('/api/management', managementOpenApiDiscoveryHeader())
    .use('/api/management/*', managementOpenApiDiscoveryHeader())
    .use('/api/management', managementBearerAuth(auth))
    .use('/api/management/*', managementBearerAuth(auth))
    .get(managementOpenApiPath, (c) => c.json(managementOpenApiForRequest(c.req.url)))
    .route('/api/management', createManagementAssetRoutes(options.assetServiceFactory))
    .route(
      '/api/management',
      createManagementRoutes({
        authApi: managementApi,
        userRepository: options.userRepository,
        securityRepository: options.securityRepository,
        securityPolicy: options.securityPolicy,
        configzServiceFactory: options.configzServiceFactory,
        applicationServiceFactory: options.applicationServiceFactory,
        connectorServiceFactory: options.connectorServiceFactory,
        webhookServiceFactory: options.webhookServiceFactory,
      }),
    )

  if (options.onboardingRepository) {
    api = api.route('/api/onboarding', onboardingRoutes(options.onboardingRepository))
  }

  return api
}

function managementOpenApiDiscoveryHeader() {
  return async (c: Context, next: () => Promise<void>) => {
    await next()
    if (c.req.path === managementOpenApiPath) return
    c.header('Link', managementOpenApiLinkHeader)
  }
}

function mountRpcRoutes(app: Hono, auth: AuthHandler, options: RpcAppOptions) {
  const managementApi = auth.api as unknown as ManagementAuthApi
  return mountCoreApiRoutes(app, auth, options)
    .route(
      '/api/admin/users',
      adminUserRoutes(managementApi, options.userRepository, { securityRepository: options.securityRepository }),
    )
    .route(
      '/api/account',
      accountRoutes(
        managementApi,
        options.userRepository,
        options.securityRepository,
        options.applicationServiceFactory,
        options.configzServiceFactory,
        options.walletRepository,
      ),
    )
    .route(
      '/api/account',
      createAccountAssetRoutes(
        options.assetServiceFactory,
        options.configzServiceFactory
          ? async (c) =>
              (await options.configzServiceFactory!(c as unknown as Context<{ Bindings: ConfigzBindings }>).getConfig())
                .accountCenter
          : undefined,
      ),
    )
    .route(
      '/api/admin/security',
      adminSecurityRoutes(managementApi, options.userRepository, options.securityRepository),
    )
}

async function requireOnboardingComplete(onboarding: OnboardingRepository) {
  if (!(await onboarding.hasUsers())) {
    throw forbidden('Complete first-admin onboarding before using auth flows.')
  }
}

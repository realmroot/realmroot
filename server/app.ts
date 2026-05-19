import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import { Hono } from 'hono'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'
import type {
  AccountEmailChangeInput,
  AccountPasswordChangeInput,
  AccountProfileResponse,
  AccountProfileUpdateInput,
  AccountSecurityResponse,
  AccountSessionsResponse,
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
  ApiResourceResponse,
  CreateApiResourceRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  ListApiResourcesResponse,
  ListOrganizationsResponse,
  ListRolesResponse,
  OrganizationResponse,
  RoleResponse,
  UpdateApiResourceRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '../shared/api/authorization'
import type { ConfigzConfigResponse } from '../shared/api/configz'
import type { ConnectorReadinessResponse, ListConnectorTemplatesResponse } from '../shared/api/connectors'
import type {
  CreateManagementConnectorRequest,
  ListManagementConnectorsResponse,
  ListManagementUsersResponse,
  ManagementBrandingSettingsResponse,
  ManagementConnectorResponse,
  ManagementCreateUserRequest,
  ManagementReadinessResponse,
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserListQuery,
  ManagementUserResponse,
  UpdateManagementBrandingSettingsRequest,
  UpdateManagementConnectorRequest,
  UpdateManagementSignInSettingsRequest,
} from '../shared/api/management'
import type {
  PasskeysResponse,
  SecurityPasskeyRegistrationOptionsInput,
  SecurityPolicy,
  SecurityTotpDisableInput,
  SecurityTotpEnrollmentInput,
  SecurityTotpVerificationInput,
} from '../shared/api/security'
import type { Auth } from './auth'
import { forbidden, handleApiError, notFound } from './lib/errors'
import { accessLog } from './middleware/access-log'
import { authContext, type SessionReader } from './middleware/auth-context'
import { trustedOriginCors } from './middleware/cors'
import { requestContext } from './middleware/request-context'
import { requireDeploymentMfa } from './middleware/security-policy'
import type { OnboardingRepository } from './modules/onboarding/repository'
import type { SecurityRepository } from './modules/security/repository'
import type { UserRepository } from './modules/users/repository'
import { accountRoutes } from './routes/account'
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
import { oauthConsentRoute } from './routes/oauth/consent'
import { onboardingRoutes } from './routes/onboarding'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
  } & SessionReader['api']
}

export interface AppOptions {
  trustedOrigins?: string[]
  userRepository?: UserRepository
  securityRepository?: SecurityRepository
  onboardingRepository?: OnboardingRepository
  securityPolicy?: SecurityPolicy
  configzServiceFactory?: ConfigzServiceFactory & ManagementConfigzServiceFactory
  applicationServiceFactory?: ManagementApplicationServiceFactory
  connectorServiceFactory?: ConnectorServiceFactory
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
  app.use('/api/*', trustedOriginCors(options.trustedOrigins ?? []))
  app.use('/api/*', authContext(auth))

  if (options.securityRepository && options.securityPolicy) {
    app.use('/api/*', requireDeploymentMfa(options.securityPolicy, options.securityRepository))
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
      app.route('/api/admin/users', adminUserRoutes(managementApi, options.userRepository))
      app.route(
        '/api/account',
        accountRoutes(
          managementApi,
          options.userRepository,
          options.securityRepository,
          options.applicationServiceFactory,
        ),
      )
      app.route('/api/account', createAccountAssetRoutes(options.assetServiceFactory))
    }
  }

  app.get('/api/auth/.well-known/openid-configuration', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    if (options.onboardingRepository) {
      await requireOnboardingComplete(options.onboardingRepository)
    }

    return auth.handler(c.req.raw)
  })
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) => oauthProviderAuthServerMetadata(auth)(c.req.raw))

  return app
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
  '/api/account/password/change': {
    $post: RpcEndpoint<{ json: AccountPasswordChangeInput }, EmptyResponse>
  }
  '/api/account/linked-accounts': {
    $get: RpcEndpoint<RpcNoInput, LinkedAccountsResponse>
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
  '/api/account/security/passkeys/registration-options': {
    $post: RpcEndpoint<{ json: SecurityPasskeyRegistrationOptionsInput }, EmptyResponse>
  }
  '/api/account/security/passkeys/registration-verification': {
    $post: RpcEndpoint<{ json: Record<string, unknown> }, EmptyResponse, 201>
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
    $patch: RpcEndpoint<{ param: { id: string }; json: ManagementUpdateUserRequest }, { user: ManagementUserResponse }>
  }
  '/api/management/users/password-reset-requests': {
    $post: RpcEndpoint<{ json: { email: string } }, EmptyResponse>
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
  '/api/management/readiness': {
    $get: RpcEndpoint<RpcNoInput, ManagementReadinessResponse>
  }
  '/api/management/security/policy': {
    $get: RpcEndpoint<RpcNoInput, { policy: SecurityPolicy }>
  }
  '/api/management/organizations': {
    $get: RpcEndpoint<RpcNoInput, ListOrganizationsResponse>
    $post: RpcEndpoint<{ json: CreateOrganizationRequest }, OrganizationResponse, 201>
  }
  '/api/management/organizations/:id': {
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateOrganizationRequest }, OrganizationResponse>
  }
  '/api/management/roles': {
    $get: RpcEndpoint<RpcNoInput, ListRolesResponse>
    $post: RpcEndpoint<{ json: CreateRoleRequest }, RoleResponse, 201>
  }
  '/api/management/roles/:id': {
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateRoleRequest }, RoleResponse>
  }
  '/api/management/api-resources': {
    $get: RpcEndpoint<RpcNoInput, ListApiResourcesResponse>
    $post: RpcEndpoint<{ json: CreateApiResourceRequest }, ApiResourceResponse, 201>
  }
  '/api/management/api-resources/:id': {
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateApiResourceRequest }, ApiResourceResponse>
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
      }),
    )

  if (options.onboardingRepository) {
    api = api.route('/api/onboarding', onboardingRoutes(options.onboardingRepository))
  }

  return api
}

function mountRpcRoutes(app: Hono, auth: AuthHandler, options: RpcAppOptions) {
  const managementApi = auth.api as unknown as ManagementAuthApi
  return mountCoreApiRoutes(app, auth, options)
    .route('/api/admin/users', adminUserRoutes(managementApi, options.userRepository))
    .route(
      '/api/account',
      accountRoutes(
        managementApi,
        options.userRepository,
        options.securityRepository,
        options.applicationServiceFactory,
      ),
    )
    .route('/api/account', createAccountAssetRoutes(options.assetServiceFactory))
    .route(
      '/api/admin/security',
      adminSecurityRoutes(managementApi, options.userRepository, options.securityRepository, options.securityPolicy),
    )
}

async function requireOnboardingComplete(onboarding: OnboardingRepository) {
  if (!(await onboarding.hasUsers())) {
    throw forbidden('Complete first-admin onboarding before using auth flows.')
  }
}

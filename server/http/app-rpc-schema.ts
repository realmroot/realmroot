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
} from '@shared/api/account'
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
} from '@shared/api/applications'
import type { UploadedAssetResponse } from '@shared/api/assets'
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
} from '@shared/api/authorization'
import type { ConfigzConfigResponse } from '@shared/api/configz'
import type {
  ConnectorReadinessResponse,
  LinkAccountRequest,
  ListConnectorTemplatesResponse,
} from '@shared/api/connectors'
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
} from '@shared/api/management'
import type { OnboardingAdminRequest } from '@shared/api/onboarding'
import type {
  PasskeysResponse,
  SecurityPolicy,
  SecurityTotpDisableInput,
  SecurityTotpEnrollmentInput,
  SecurityTotpVerificationInput,
  UpdateSecurityPolicyInput,
} from '@shared/api/security'
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
} from '@shared/api/webhooks'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'

export type EmptyResponse = Record<string, unknown>
export type RpcNoInput = Record<never, never>
export type RpcEndpoint<Input, Output, Status extends StatusCode = ContentfulStatusCode> = {
  input: Input
  output: Output
  outputFormat: 'json'
  status: Status
}
export type RpcFileUploadInput = { form: { file: File } }

export type RpcSchema = {
  '/api/health': {
    $get: RpcEndpoint<RpcNoInput, { ok: true; service: string }>
  }
  '/api/configz': {
    $get: RpcEndpoint<RpcNoInput, ConfigzConfigResponse>
  }
  '/api/onboarding/status': {
    $get: RpcEndpoint<RpcNoInput, { required: boolean }>
  }
  '/api/onboarding/admin-users': {
    $post: RpcEndpoint<
      { json: OnboardingAdminRequest },
      { user: { id: string; email: string; role: string | null }; onboarding: { locked: true } },
      201
    >
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
  '/api/account/avatar': {
    $post: RpcEndpoint<RpcFileUploadInput, UploadedAssetResponse, 201>
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
  '/api/management/applications/:applicationId/logo': {
    $post: RpcEndpoint<{ param: { applicationId: string } } & RpcFileUploadInput, UploadedAssetResponse, 201>
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
  '/api/management/branding/logo': {
    $post: RpcEndpoint<RpcFileUploadInput, UploadedAssetResponse, 201>
  }
  '/api/management/branding/favicon': {
    $post: RpcEndpoint<RpcFileUploadInput, UploadedAssetResponse, 201>
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
  '/api/management/organizations/:organizationId/logo': {
    $post: RpcEndpoint<{ param: { organizationId: string } } & RpcFileUploadInput, UploadedAssetResponse, 201>
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

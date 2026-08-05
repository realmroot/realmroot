import type {
  AccountEmailChangeConfirmInput,
  AccountEmailChangeInput,
  AccountOrganizationAgentsResponse,
  AccountOrganizationContextResponse,
  AccountPasswordChangeInput,
  AccountProfileResponse,
  AccountProfileUpdateInput,
  AccountSecurityResponse,
  AccountSessionsResponse,
  AccountWalletAddressLinkInput,
  ConsentedApplicationsResponse,
  DeveloperConsoleAccessResponse,
  LinkedAccountsResponse,
} from '@shared/api/account'
import type {
  Agent,
  ApiResource,
  createApiResourceSchema,
  ListAgentAuditEventsQuery,
  ListAgentsQuery,
  ListManagementAgentAccessGrantsQuery,
  ListManagementAgentAccessRequestsQuery,
  ManagementAgent,
  ManagementAgentAccessGrant,
  ManagementAgentAccessRequest,
  ManagementAgentInstallation,
  updateApiResourceSchema,
} from '@shared/api/agent-api'
import type { AgentAuditEvent } from '@shared/api/agents'
import type {
  ApplicationAuthorization,
  ApplicationAuthorizationRevocation,
  ApplicationResponse,
  ConsentApprovalResponse,
  ConsentRequestResponse,
  CreateApplicationRequest,
  CreateApplicationResponse,
  HostedConsentApprovalRequest,
  ListApplicationAuthorizationsQuery,
  ListApplicationAuthorizationsResponse,
  ListApplicationsQuery,
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
  ApiResourceContractResponse,
  CreateOrganizationRequest,
  CreateRoleRequest,
  ListApiResourcesQuery,
  ListOrganizationsResponse,
  ListRolesResponse,
  MemberRolesResponse,
  OrganizationResponse,
  ReplaceMemberRolesRequest,
  RoleResponse,
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
  CreateManagementFederatedCredentialRequest,
  CreateManagementFederatedCredentialResponse,
  DeveloperConsoleAccessPolicyResponse,
  EmailDeliveryConfigurationResponse,
  ListManagementConnectorsResponse,
  ListManagementFederatedCredentialsResponse,
  ListManagementUserLinkedAccountsResponse,
  ListManagementUserPasskeysResponse,
  ListManagementUserSessionsResponse,
  ListManagementUsersResponse,
  ManagementAccountCenterSettingsResponse,
  ManagementBanUserRequest,
  ManagementBrandingSettingsResponse,
  ManagementConnectorResponse,
  ManagementCreateUserRequest,
  ManagementReadinessResponse,
  ManagementRealmResponse,
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserDetailResponse,
  ManagementUserListQuery,
  ManagementUserResponse,
  OrganizationCreationPolicyResponse,
  ReplaceDeveloperConsoleAccessPolicyRequest,
  ReplaceEmailDeliveryConfigurationRequest,
  ReplaceOrganizationCreationPolicyRequest,
  UpdateManagementAccountCenterSettingsRequest,
  UpdateManagementBrandingSettingsRequest,
  UpdateManagementConnectorRequest,
  UpdateManagementFederatedCredentialRequest,
  UpdateManagementRealmRequest,
  UpdateManagementSignInSettingsRequest,
} from '@shared/api/management'
import type { OnboardingAdminRequest } from '@shared/api/onboarding'
import type { PaginationMetadata } from '@shared/api/pagination'
import type {
  PasskeysResponse,
  SecurityPolicyResponse,
  SecurityTotpDisableInput,
  SecurityTotpEnrollmentInput,
  SecurityTotpVerificationInput,
  UpdateSecurityPolicyInput,
} from '@shared/api/security'
import type {
  CreateWebhookEndpointRequest,
  ListWebhookDeliveryAttemptsResponse,
  ListWebhookEndpointsQuery,
  ListWebhookEndpointsResponse,
  ListWebhookRequestsQuery,
  ListWebhookRequestsResponse,
  UpdateWebhookEndpointRequest,
  WebhookDeliveryAttempt,
  WebhookEndpoint,
  WebhookEndpointSecretResponse,
  WebhookRequest,
} from '@shared/api/webhooks'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'

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
  '/api/account/developer-console-access': {
    $get: RpcEndpoint<RpcNoInput, DeveloperConsoleAccessResponse>
  }
  '/api/account/organization-context': {
    $get: RpcEndpoint<RpcNoInput, AccountOrganizationContextResponse>
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
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof PaginationQuery, string>> },
      { items: Agent[]; pagination: PaginationMetadata }
    >
  }
  '/api/account/agents/:agentId': {
    $get: RpcEndpoint<{ param: { agentId: string } }, { agent: Agent }>
    $delete: RpcEndpoint<{ param: { agentId: string } }, EmptyResponse, 204>
  }
  '/api/account/organizations/:organizationId/agents': {
    $get: RpcEndpoint<
      { param: { organizationId: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      AccountOrganizationAgentsResponse
    >
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
  '/api/assets': {
    $post: RpcEndpoint<
      { form: { purpose: import('@shared/api/assets').AssetPurpose; file: File } },
      import('@shared/api/assets').UploadedAssetResponse,
      201
    >
  }
  '/api/applications': {
    $get: RpcEndpoint<{ query?: Partial<Record<keyof ListApplicationsQuery, string>> }, ListApplicationsResponse>
    $post: RpcEndpoint<{ json: CreateApplicationRequest }, CreateApplicationResponse, 201>
  }
  '/api/applications/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ApplicationResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateApplicationRequest }, ApplicationResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/applications/:id/redirect-uris': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListRedirectUrisResponse
    >
    $put: RpcEndpoint<{ param: { id: string }; json: ReplaceRedirectUrisRequest }, { redirectUris: string[] }>
  }
  '/api/applications/:id/client-secrets': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListClientSecretsResponse
    >
    $post: RpcEndpoint<{ param: { id: string } }, RotateClientSecretResponse, 201>
  }
  '/api/access/consents': {
    $get: RpcEndpoint<
      {
        query?: Partial<Record<keyof ListApplicationAuthorizationsQuery, string>>
      },
      ListApplicationAuthorizationsResponse
    >
  }
  '/api/access/consents/:authorizationId': {
    $get: RpcEndpoint<{ param: { authorizationId: string } }, ApplicationAuthorization>
  }
  '/api/access/consents/:authorizationId/revocation': {
    $put: RpcEndpoint<{ param: { authorizationId: string } }, ApplicationAuthorizationRevocation>
  }
  '/api/applications/:applicationId/federated-credentials': {
    $get: RpcEndpoint<{ param: { applicationId: string } }, ListManagementFederatedCredentialsResponse>
    $post: RpcEndpoint<
      { param: { applicationId: string }; json: CreateManagementFederatedCredentialRequest },
      CreateManagementFederatedCredentialResponse,
      201
    >
  }
  '/api/applications/:applicationId/federated-credentials/:credentialId': {
    $patch: RpcEndpoint<
      { param: { applicationId: string; credentialId: string }; json: UpdateManagementFederatedCredentialRequest },
      CreateManagementFederatedCredentialResponse
    >
    $delete: RpcEndpoint<{ param: { applicationId: string; credentialId: string } }, EmptyResponse>
  }
  '/api/users': {
    $get: RpcEndpoint<{ query: Partial<Record<keyof ManagementUserListQuery, string>> }, ListManagementUsersResponse>
    $post: RpcEndpoint<{ json: ManagementCreateUserRequest }, EmptyResponse, 201>
  }
  '/api/users/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ManagementUserDetailResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: ManagementUpdateUserRequest }, { user: ManagementUserResponse }>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/users/:id/password-reset-requests': {
    $post: RpcEndpoint<{ param: { id: string }; json: { redirectTo?: string } }, EmptyResponse>
  }
  '/api/users/:id/suspension': {
    $put: RpcEndpoint<{ param: { id: string }; json: ManagementBanUserRequest }, EmptyResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/users/:id/sessions': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListManagementUserSessionsResponse
    >
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/users/:id/sessions/:sessionId': {
    $delete: RpcEndpoint<{ param: { id: string; sessionId: string } }, EmptyResponse>
  }
  '/api/users/:id/linked-accounts': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListManagementUserLinkedAccountsResponse
    >
  }
  '/api/users/:id/passkeys': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListManagementUserPasskeysResponse
    >
  }
  '/api/users/:id/passkeys/:passkeyId': {
    $delete: RpcEndpoint<{ param: { id: string; passkeyId: string } }, EmptyResponse>
  }
  '/api/connectors': {
    $get: RpcEndpoint<RpcNoInput, ListManagementConnectorsResponse>
    $post: RpcEndpoint<{ json: CreateManagementConnectorRequest }, ManagementConnectorResponse, 201>
  }
  '/api/connectors/templates': {
    $get: RpcEndpoint<RpcNoInput, ListConnectorTemplatesResponse>
  }
  '/api/connectors/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ManagementConnectorResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateManagementConnectorRequest }, ManagementConnectorResponse>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse>
  }
  '/api/connectors/:id/readiness': {
    $get: RpcEndpoint<{ param: { id: string } }, ConnectorReadinessResponse>
  }
  '/api/realm/sign-in-policy': {
    $get: RpcEndpoint<RpcNoInput, ManagementSignInSettingsResponse>
    $patch: RpcEndpoint<{ json: UpdateManagementSignInSettingsRequest }, ManagementSignInSettingsResponse>
  }
  '/api/realm/branding': {
    $get: RpcEndpoint<RpcNoInput, ManagementBrandingSettingsResponse>
    $patch: RpcEndpoint<{ json: UpdateManagementBrandingSettingsRequest }, ManagementBrandingSettingsResponse>
  }
  '/api/webhooks': {
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof ListWebhookEndpointsQuery, string>> },
      ListWebhookEndpointsResponse
    >
    $post: RpcEndpoint<{ json: CreateWebhookEndpointRequest }, WebhookEndpointSecretResponse, 201>
  }
  '/api/webhooks/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, WebhookEndpoint>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateWebhookEndpointRequest }, WebhookEndpoint>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse, 204>
  }
  '/api/webhooks/:id/secrets': {
    $post: RpcEndpoint<{ param: { id: string } }, WebhookEndpointSecretResponse, 201>
  }
  '/api/webhooks/:id/deliveries': {
    $get: RpcEndpoint<
      { param: { id: string }; query?: Partial<Record<keyof ListWebhookRequestsQuery, string>> },
      ListWebhookRequestsResponse
    >
  }
  '/api/webhooks/:id/deliveries/:deliveryId': {
    $get: RpcEndpoint<{ param: { id: string; deliveryId: string } }, WebhookRequest>
  }
  '/api/webhooks/:id/deliveries/:deliveryId/attempts': {
    $get: RpcEndpoint<
      { param: { id: string; deliveryId: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      ListWebhookDeliveryAttemptsResponse
    >
    $post: RpcEndpoint<
      { param: { id: string; deliveryId: string }; header: { 'Idempotency-Key': string } },
      WebhookDeliveryAttempt,
      201
    >
  }
  '/api/webhooks/:id/deliveries/:deliveryId/attempts/:attemptId': {
    $get: RpcEndpoint<{ param: { id: string; deliveryId: string; attemptId: string } }, WebhookDeliveryAttempt>
  }
  '/api/realm/account-management-policy': {
    $get: RpcEndpoint<RpcNoInput, ManagementAccountCenterSettingsResponse>
    $patch: RpcEndpoint<{ json: UpdateManagementAccountCenterSettingsRequest }, ManagementAccountCenterSettingsResponse>
  }
  '/api/realm/organization-creation-policy': {
    $get: RpcEndpoint<RpcNoInput, OrganizationCreationPolicyResponse>
    $put: RpcEndpoint<
      { json: ReplaceOrganizationCreationPolicyRequest; header: { 'If-Match': string } },
      OrganizationCreationPolicyResponse
    >
  }
  '/api/realm/developer-console-access-policy': {
    $get: RpcEndpoint<RpcNoInput, DeveloperConsoleAccessPolicyResponse>
    $put: RpcEndpoint<
      { json: ReplaceDeveloperConsoleAccessPolicyRequest; header: { 'If-Match': string } },
      DeveloperConsoleAccessPolicyResponse
    >
  }
  '/api/realm': {
    $get: RpcEndpoint<RpcNoInput, ManagementRealmResponse>
    $patch: RpcEndpoint<{ json: UpdateManagementRealmRequest; header: { 'If-Match': string } }, ManagementRealmResponse>
  }
  '/api/realm/email-delivery-configuration': {
    $get: RpcEndpoint<RpcNoInput, EmailDeliveryConfigurationResponse>
    $put: RpcEndpoint<
      { json: ReplaceEmailDeliveryConfigurationRequest; header: { 'If-Match': string } },
      EmailDeliveryConfigurationResponse
    >
  }
  '/api/realm/configuration-status': {
    $get: RpcEndpoint<RpcNoInput, ManagementReadinessResponse>
  }
  '/api/agents': {
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof ListAgentsQuery, string>> },
      { items: ManagementAgent[]; pagination: PaginationMetadata }
    >
  }
  '/api/agents/:agentId': {
    $get: RpcEndpoint<{ param: { agentId: string } }, { agent: ManagementAgent }>
  }
  '/api/agents/:agentId/retirement': {
    $put: RpcEndpoint<{ param: { agentId: string } }, EmptyResponse, 204>
  }
  '/api/agents/:agentId/installations': {
    $get: RpcEndpoint<
      { param: { agentId: string }; query?: Partial<Record<keyof PaginationQuery, string>> },
      { items: ManagementAgentInstallation[]; pagination: PaginationMetadata }
    >
  }
  '/api/access/requests': {
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof ListManagementAgentAccessRequestsQuery, string>> },
      { items: ManagementAgentAccessRequest[]; pagination: PaginationMetadata }
    >
  }
  '/api/access/requests/:requestId': {
    $get: RpcEndpoint<{ param: { requestId: string } }, ManagementAgentAccessRequest>
  }
  '/api/access/authorizations': {
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof ListManagementAgentAccessGrantsQuery, string>> },
      { items: ManagementAgentAccessGrant[]; pagination: PaginationMetadata }
    >
  }
  '/api/access/authorizations/:authorizationId': {
    $get: RpcEndpoint<{ param: { authorizationId: string } }, ManagementAgentAccessGrant>
  }
  '/api/realm/audit-events': {
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof ListAgentAuditEventsQuery, string>> },
      { items: AgentAuditEvent[]; pagination: PaginationMetadata }
    >
  }
  '/api/realm/security-policy': {
    $get: RpcEndpoint<RpcNoInput, { policy: SecurityPolicyResponse }>
    $patch: RpcEndpoint<{ json: UpdateSecurityPolicyInput }, { policy: SecurityPolicyResponse }>
  }
  '/api/organizations': {
    $get: RpcEndpoint<RpcNoInput, ListOrganizationsResponse>
    $post: RpcEndpoint<{ json: CreateOrganizationRequest }, OrganizationResponse, 201>
  }
  '/api/organizations/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, OrganizationResponse>
    $patch: RpcEndpoint<{ param: { id: string }; json: UpdateOrganizationRequest }, OrganizationResponse>
  }
  '/api/organizations/:organizationId/roles': {
    $get: RpcEndpoint<{ param: { organizationId: string } }, ListRolesResponse>
    $post: RpcEndpoint<{ param: { organizationId: string }; json: CreateRoleRequest }, RoleResponse, 201>
  }
  '/api/organizations/:organizationId/roles/:roleKey': {
    $get: RpcEndpoint<{ param: { organizationId: string; roleKey: string } }, RoleResponse>
    $patch: RpcEndpoint<{ param: { organizationId: string; roleKey: string }; json: UpdateRoleRequest }, RoleResponse>
    $delete: RpcEndpoint<{ param: { organizationId: string; roleKey: string } }, EmptyResponse, 204>
  }
  '/api/organizations/:organizationId/members/:memberId/roles': {
    $get: RpcEndpoint<{ param: { organizationId: string; memberId: string } }, MemberRolesResponse>
    $put: RpcEndpoint<
      { param: { organizationId: string; memberId: string }; json: ReplaceMemberRolesRequest },
      MemberRolesResponse
    >
  }
  '/api/resource-servers': {
    $get: RpcEndpoint<
      { query?: Partial<Record<keyof ListApiResourcesQuery, string>> },
      { items: ApiResource[]; pagination: PaginationMetadata }
    >
    $post: RpcEndpoint<{ json: z.input<typeof createApiResourceSchema> }, ApiResource, 201>
  }
  '/api/resource-servers/:id': {
    $get: RpcEndpoint<{ param: { id: string } }, ApiResource>
    $patch: RpcEndpoint<{ param: { id: string }; json: z.infer<typeof updateApiResourceSchema> }, ApiResource>
    $delete: RpcEndpoint<{ param: { id: string } }, EmptyResponse, 204>
  }
  '/api/resource-servers/:id/contract': {
    $get: RpcEndpoint<{ param: { id: string } }, ApiResourceContractResponse>
  }
  '/api/resource-servers/:id/archival': {
    $put: RpcEndpoint<{ param: { id: string } }, ApiResource>
    $delete: RpcEndpoint<{ param: { id: string } }, ApiResource>
  }
}

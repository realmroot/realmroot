export type ResourceBoundaryKind = 'realm' | 'user' | 'organization'

export interface ResourceOwnershipDefinition {
  boundary: ResourceBoundaryKind | 'tenant'
  persistedBy: string
  children: readonly string[]
}

/**
 * Public resource families whose persisted boundary participates in authorization.
 * Child resources inherit this boundary and never accept an independent owner.
 */
export const resourceOwnershipInventory = {
  organizations: {
    boundary: 'organization',
    persistedBy: 'organization.id',
    children: ['member', 'invitation', 'organization_role'],
  },
  applications: {
    boundary: 'organization',
    persistedBy: 'application.owner_organization_id',
    children: ['application_client_metadata', 'application_client_secret', 'federated_credential'],
  },
  applicationConsents: {
    boundary: 'user',
    persistedBy: 'application_consent.user_id',
    children: [],
  },
  resourceServers: {
    boundary: 'organization',
    persistedBy: 'api_resource.owner_organization_id',
    children: ['api_resource_eligible_organization'],
  },
  agents: {
    boundary: 'tenant',
    persistedBy: 'agent_identity.owner_user_id xor owner_organization_id',
    children: ['agent_identity_binding', 'agent_access_request', 'agent_access_grant'],
  },
  resourceConnections: {
    boundary: 'tenant',
    persistedBy: 'resource_account_connection.owner_user_id xor owner_organization_id',
    children: ['resource_connection_intent', 'external_token_lease'],
  },
  webhooks: {
    boundary: 'organization',
    persistedBy: 'webhook_endpoint.organization_id; null means realm',
    children: ['webhook_delivery_request', 'webhook_delivery_attempt'],
  },
  platformConfiguration: {
    boundary: 'realm',
    persistedBy: 'resource kind',
    children: ['identity_provider_connector', 'email_service_config', 'sign_in_experience', 'deployment_setting'],
  },
  auditEvents: {
    boundary: 'tenant',
    persistedBy: 'agent_audit_event.realm_owned xor owner_user_id xor owner_organization_id',
    children: [],
  },
} as const satisfies Record<string, ResourceOwnershipDefinition>

import { type ProtectedResourceScope, protectedResourceScopes, type RealmrootAuthorityKind } from './authz'

export interface ManagementOperationPolicy {
  scope: ProtectedResourceScope
  authorities: readonly RealmrootAuthorityKind[]
  sessionAuthorities: readonly RealmrootAuthorityKind[]
  actor: 'principal' | 'human-controller'
}

interface ManagementPolicyRule extends ManagementOperationPolicy {
  method: string
  path: RegExp
}

type Actor = ManagementOperationPolicy['actor']

const realm = ['realm'] as const
const realmOrOrganization = ['realm', 'organization'] as const
const everyAuthority = ['realm', 'organization', 'account'] as const

/**
 * The one management authorization declaration. Runtime authorization,
 * session capability checks, OpenAPI security, and authority-specific scope
 * discovery all consume this exact method-and-route registry. Unknown routes
 * are denied instead of inheriting policy from a broad path prefix.
 */
const managementPolicyRules: readonly ManagementPolicyRule[] = [
  ...rules(['POST'], ['assets'], 'applications:write', realmOrOrganization, realmOrOrganization, 'human-controller'),

  ...rules(['GET'], ['organizations'], 'organizations:read', realmOrOrganization, realmOrOrganization),
  ...rules(['POST'], ['organizations'], 'organizations:write', realm, realm, 'human-controller'),
  ...rules(
    ['GET'],
    [
      'organizations/{organizationId}',
      'organizations/{organizationId}/members',
      'organizations/{organizationId}/members/{memberId}',
      'organizations/{organizationId}/invitations',
      'organizations/{organizationId}/invitations/{invitationId}',
    ],
    'organizations:read',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(
    ['PATCH', 'DELETE'],
    ['organizations/{organizationId}'],
    'organizations:write',
    realmOrOrganization,
    realm,
    'human-controller',
  ),
  ...rules(
    ['POST', 'PATCH', 'DELETE'],
    [
      'organizations/{organizationId}/members',
      'organizations/{organizationId}/members/{memberId}',
      'organizations/{organizationId}/invitations/{invitationId}',
    ],
    'organizations:write',
    realmOrOrganization,
    realm,
    'human-controller',
  ),
  ...rules(
    ['POST'],
    ['organizations/{organizationId}/invitations'],
    'organizations:write',
    realmOrOrganization,
    realm,
  ),

  ...rules(
    ['GET'],
    [
      'users',
      'users/{userId}',
      'users/{userId}/suspension',
      'users/{userId}/password-reset-requests/{requestId}',
      'users/{userId}/sessions',
      'users/{userId}/sessions/{sessionId}',
      'users/{userId}/linked-accounts',
      'users/{userId}/passkeys',
    ],
    'users:read',
    realm,
    realmOrOrganization,
  ),
  ...rules(
    ['POST', 'PATCH', 'PUT', 'DELETE'],
    [
      'users',
      'users/{userId}',
      'users/{userId}/suspension',
      'users/{userId}/password-reset-requests',
      'users/{userId}/sessions',
      'users/{userId}/sessions/{sessionId}',
      'users/{userId}/passkeys/{passkeyId}',
    ],
    'users:write',
    realm,
    realm,
    'human-controller',
  ),

  ...rules(
    ['GET'],
    ['access/roles', 'access/roles/{roleId}', 'access/roles/{roleId}/scopes'],
    'roles:read',
    realm,
    realmOrOrganization,
  ),
  ...rules(
    ['POST', 'PATCH', 'PUT', 'DELETE'],
    ['access/roles', 'access/roles/{roleId}', 'access/roles/{roleId}/scopes'],
    'roles:write',
    realm,
    realm,
    'human-controller',
  ),
  ...rules(
    ['GET'],
    ['access/assignments', 'access/assignments/{assignmentId}', 'access/assignments/{assignmentId}/revocation'],
    'roles:read',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(['POST'], ['access/assignments'], 'roles:write', realmOrOrganization, realmOrOrganization),
  ...rules(
    ['PUT'],
    ['access/assignments/{assignmentId}/revocation'],
    'roles:write',
    realmOrOrganization,
    realmOrOrganization,
    'human-controller',
  ),

  ...rules(
    ['GET'],
    [
      'applications',
      'applications/{applicationId}',
      'applications/{applicationId}/redirect-uris',
      'applications/{applicationId}/client-secrets',
      'applications/{applicationId}/federated-credentials',
      'applications/{applicationId}/federated-credentials/{credentialId}',
      'access/consents',
      'access/consents/{consentId}',
      'access/consents/{consentId}/revocation',
    ],
    'applications:read',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(['POST'], ['applications'], 'applications:write', realmOrOrganization, realmOrOrganization),
  ...rules(
    ['POST'],
    ['applications/{applicationId}/client-secrets'],
    'applications:write',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(
    ['PATCH', 'PUT', 'DELETE', 'POST'],
    [
      'applications/{applicationId}',
      'applications/{applicationId}/redirect-uris',
      'applications/{applicationId}/federated-credentials',
      'applications/{applicationId}/federated-credentials/{credentialId}',
      'access/consents/{consentId}/revocation',
    ],
    'applications:write',
    realmOrOrganization,
    realmOrOrganization,
    'human-controller',
  ),

  ...rules(
    ['GET'],
    [
      'resource-servers',
      'resource-servers/{resourceServerId}',
      'resource-servers/{resourceServerId}/contract',
      'resource-servers/{resourceServerId}/archival',
    ],
    'resource-servers:read',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(['POST'], ['resource-servers'], 'resource-servers:write', realmOrOrganization, realmOrOrganization),
  ...rules(
    ['PUT', 'DELETE'],
    ['resource-servers/{resourceServerId}/archival'],
    'resource-servers:write',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(
    ['PATCH', 'DELETE'],
    ['resource-servers/{resourceServerId}'],
    'resource-servers:write',
    realmOrOrganization,
    realmOrOrganization,
    'human-controller',
  ),

  ...rules(
    ['GET'],
    [
      'agents',
      'agents/{agentId}',
      'agents/{agentId}/installations',
      'agents/{agentId}/retirement',
      'access/requests',
      'access/requests/{requestId}',
      'access/requests/{requestId}/decision',
      'access/authorizations',
      'access/authorizations/{authorizationId}',
      'access/authorizations/{authorizationId}/revocation',
    ],
    'agents:read',
    everyAuthority,
    everyAuthority,
  ),
  ...rules(
    ['PUT', 'DELETE'],
    ['agents/{agentId}/retirement'],
    'agents:write',
    everyAuthority,
    everyAuthority,
    'human-controller',
  ),
  ...rules(
    ['PUT'],
    ['access/requests/{requestId}/decision', 'access/authorizations/{authorizationId}/revocation'],
    'agents:write',
    everyAuthority,
    everyAuthority,
    'human-controller',
  ),

  ...rules(['GET'], ['realm/audit-events'], 'audit-events:read', everyAuthority, everyAuthority),

  ...rules(
    ['GET'],
    ['connectors', 'connectors/templates', 'connectors/{connectorId}', 'connectors/{connectorId}/readiness'],
    'connectors:read',
    realm,
    realm,
  ),
  ...rules(
    ['POST', 'PATCH', 'DELETE'],
    ['connectors', 'connectors/{connectorId}'],
    'connectors:write',
    realm,
    realm,
    'human-controller',
  ),

  ...rules(
    ['GET'],
    [
      'webhooks',
      'webhooks/{webhookId}',
      'webhooks/{webhookId}/deliveries',
      'webhooks/{webhookId}/deliveries/{deliveryId}',
      'webhooks/{webhookId}/deliveries/{deliveryId}/attempts',
      'webhooks/{webhookId}/deliveries/{deliveryId}/attempts/{attemptId}',
    ],
    'webhooks:read',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(
    ['POST'],
    ['webhooks', 'webhooks/{webhookId}/secrets'],
    'webhooks:write',
    realmOrOrganization,
    realmOrOrganization,
  ),
  ...rules(
    ['PATCH', 'DELETE', 'POST'],
    ['webhooks/{webhookId}', 'webhooks/{webhookId}/deliveries/{deliveryId}/attempts'],
    'webhooks:write',
    realmOrOrganization,
    realmOrOrganization,
    'human-controller',
  ),

  ...rules(['GET'], ['realm/security-policy'], 'security:read', realm, realm),
  ...rules(['PATCH'], ['realm/security-policy'], 'security:write', realm, realm, 'human-controller'),
  ...rules(['GET'], ['realm/configuration-status'], 'readiness:read', realm, realm),
  ...rules(
    ['GET'],
    [
      'realm',
      'realm/sign-in-policy',
      'realm/branding',
      'realm/account-management-policy',
      'realm/organization-creation-policy',
      'realm/developer-console-access-policy',
      'realm/email-delivery-configuration',
    ],
    'settings:read',
    realm,
    realm,
  ),
  ...rules(
    ['PATCH', 'PUT'],
    [
      'realm',
      'realm/sign-in-policy',
      'realm/branding',
      'realm/account-management-policy',
      'realm/organization-creation-policy',
      'realm/developer-console-access-policy',
      'realm/email-delivery-configuration',
    ],
    'settings:write',
    realm,
    realm,
    'human-controller',
  ),
]

export function managementOperationPolicy(method: string, path: string): ManagementOperationPolicy | null {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = path.replace(/^\/api\/?/, '').replace(/^\/+/, '')
  if (normalizedPath.startsWith('agent/')) return null

  const policy = managementPolicyRules.find(
    (candidate) => candidate.path.test(normalizedPath) && candidate.method === normalizedMethod,
  )
  if (!policy) return null
  return {
    scope: policy.scope,
    authorities: policy.authorities,
    sessionAuthorities: policy.sessionAuthorities,
    actor: policy.actor,
  }
}

export function managementScopesForAuthority(authority: RealmrootAuthorityKind): ProtectedResourceScope[] {
  const allowed = new Set(
    managementPolicyRules
      .filter((policy) => policy.authorities.includes(authority) && policy.actor !== 'human-controller')
      .map((policy) => policy.scope),
  )
  return protectedResourceScopes.filter((scope) => allowed.has(scope))
}

function rules(
  methods: readonly string[],
  paths: readonly string[],
  scope: ProtectedResourceScope,
  authorities: readonly RealmrootAuthorityKind[],
  sessionAuthorities: readonly RealmrootAuthorityKind[],
  actor: Actor = 'principal',
): ManagementPolicyRule[] {
  return methods.flatMap((method) =>
    (method === 'GET' ? ['GET', 'HEAD'] : [method]).flatMap((resolvedMethod) =>
      paths.map((path) => ({
        method: resolvedMethod,
        path: exactPath(path),
        scope,
        authorities,
        sessionAuthorities,
        actor,
      })),
    ),
  )
}

function exactPath(template: string): RegExp {
  const source = template
    .split('/')
    .map((segment) => (/^\{[^{}]+\}$/.test(segment) ? '[^/]+' : escapeRegExp(segment)))
    .join('\\/')
  return new RegExp(`^${source}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

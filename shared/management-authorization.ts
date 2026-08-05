import { type ProtectedResourceScope, protectedResourceScopes, type RealmrootAuthorityKind } from './authz'

export interface ManagementOperationPolicy {
  scope: ProtectedResourceScope
  authorities: readonly RealmrootAuthorityKind[]
  actor: 'principal' | 'human-controller'
}

interface ManagementPolicyRule extends ManagementOperationPolicy {
  methods: readonly string[]
  path: RegExp
}

const read = ['GET', 'HEAD'] as const
const mutate = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
const realm = ['realm'] as const
const realmOrOrganization = ['realm', 'organization'] as const
const everyAuthority = ['realm', 'organization', 'account'] as const

/**
 * The one management authorization declaration. Runtime authorization,
 * OpenAPI security, and authority-specific scope discovery all consume it.
 */
const managementPolicyRules: readonly ManagementPolicyRule[] = [
  rule(/^assets$/, 'applications:write', realmOrOrganization, ['POST']),

  rule(/^organizations$/, 'organizations:write', realm, ['POST']),
  ...resourceRules(/^organizations(?:\/|$)/, 'organizations:read', 'organizations:write', realmOrOrganization),

  ...resourceRules(/^users(?:\/|$)/, 'users:read', 'users:write', realm),

  ...resourceRules(/^access\/roles(?:\/|$)/, 'roles:read', 'roles:write', realm),
  ...resourceRules(/^access\/assignments(?:\/|$)/, 'roles:read', 'roles:write', realmOrOrganization),

  ...resourceRules(
    /^(?:applications|access\/consents)(?:\/|$)/,
    'applications:read',
    'applications:write',
    realmOrOrganization,
  ),
  ...resourceRules(/^resource-servers(?:\/|$)/, 'resource-servers:read', 'resource-servers:write', realmOrOrganization),
  ...resourceRules(/^connectors(?:\/|$)/, 'connectors:read', 'connectors:write', realm),
  ...resourceRules(/^webhooks(?:\/|$)/, 'webhooks:read', 'webhooks:write', realmOrOrganization),

  ...resourceRules(/^agents(?:\/|$)/, 'agents:read', 'agents:write', everyAuthority),
  rule(/^access\/requests\/[^/]+\/decision$/, 'agents:write', everyAuthority, mutate, 'human-controller'),
  ...resourceRules(/^access\/requests(?:\/|$)/, 'agents:read', 'agents:write', everyAuthority),
  rule(/^access\/authorizations\/[^/]+\/revocation$/, 'agents:write', everyAuthority, mutate, 'human-controller'),
  ...resourceRules(/^access\/authorizations(?:\/|$)/, 'agents:read', 'agents:write', everyAuthority),

  rule(/^realm\/audit-events$/, 'audit-events:read', everyAuthority, read),
  rule(/^realm\/security-policy$/, 'security:write', realm, mutate, 'human-controller'),
  rule(/^realm\/security-policy$/, 'security:read', realm, read),
  rule(/^realm\/configuration-status$/, 'readiness:read', realm, read),
  ...resourceRules(/^realm(?:\/|$)/, 'settings:read', 'settings:write', realm),
]

export function managementOperationPolicy(method: string, path: string): ManagementOperationPolicy | null {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = path.replace(/^\/api\/?/, '').replace(/^\/+/, '')
  if (normalizedPath.startsWith('agent/')) return null

  const policy = managementPolicyRules.find(
    (candidate) => candidate.path.test(normalizedPath) && candidate.methods.includes(normalizedMethod),
  )
  if (!policy) return null
  return { scope: policy.scope, authorities: policy.authorities, actor: policy.actor }
}

export function managementScopesForAuthority(authority: RealmrootAuthorityKind): ProtectedResourceScope[] {
  const allowed = new Set(
    managementPolicyRules
      .filter((policy) => policy.authorities.includes(authority) && policy.actor !== 'human-controller')
      .map((policy) => policy.scope),
  )
  return protectedResourceScopes.filter((scope) => allowed.has(scope))
}

function rule(
  path: RegExp,
  scope: ProtectedResourceScope,
  authorities: readonly RealmrootAuthorityKind[],
  methods: readonly string[],
  actor: ManagementOperationPolicy['actor'] = 'principal',
): ManagementPolicyRule {
  return { path, scope, authorities, methods, actor }
}

function resourceRules(
  path: RegExp,
  readScope: ProtectedResourceScope,
  writeScope: ProtectedResourceScope,
  authorities: readonly RealmrootAuthorityKind[],
): ManagementPolicyRule[] {
  return [rule(path, readScope, authorities, read), rule(path, writeScope, authorities, mutate)]
}

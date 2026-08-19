import { relations } from 'drizzle-orm'
import { agentIdentity } from './agent-identity-tables'
import { agent, agentCapabilityGrant, agentHost, approvalRequest, uploadedAsset } from './agent-tables'
import {
  account,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  passkey,
  session,
  twoFactor,
  user,
} from './auth-tables'
import {
  apiResource,
  application,
  applicationClientSecret,
  applicationConsent,
  invitation,
  member,
  organization,
  organizationRole,
  team,
  teamMember,
} from './authorization-tables'
import { resourceScopeEntitlement } from './resource-scope-entitlement-tables'

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  passkeys: many(passkey),
  twoFactors: many(twoFactor),
  oauthClients: many(oauthClient),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
  oauthConsents: many(oauthConsent),
  ownedApplications: many(application),
  organizationMemberships: many(member),
  teamMemberships: many(teamMember),
  agentHosts: many(agentHost),
  agents: many(agent),
  grantedAgentCapabilities: many(agentCapabilityGrant, { relationName: 'grantedAgentCapabilities' }),
  deniedAgentCapabilities: many(agentCapabilityGrant, { relationName: 'deniedAgentCapabilities' }),
  agentApprovalRequests: many(approvalRequest),
  scopeEntitlements: many(resourceScopeEntitlement, { relationName: 'entitlementSubjectUser' }),
  grantedScopeEntitlements: many(resourceScopeEntitlement, { relationName: 'entitlementGrantor' }),
}))

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, {
    fields: [twoFactor.userId],
    references: [user.id],
  }),
}))

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, {
    fields: [passkey.userId],
    references: [user.id],
  }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const agentHostRelations = relations(agentHost, ({ one, many }) => ({
  user: one(user, {
    fields: [agentHost.userId],
    references: [user.id],
  }),
  agents: many(agent),
  approvalRequests: many(approvalRequest),
}))

export const agentRelations = relations(agent, ({ one, many }) => ({
  user: one(user, {
    fields: [agent.userId],
    references: [user.id],
  }),
  host: one(agentHost, {
    fields: [agent.hostId],
    references: [agentHost.id],
  }),
  grants: many(agentCapabilityGrant),
  approvalRequests: many(approvalRequest),
}))

export const agentCapabilityGrantRelations = relations(agentCapabilityGrant, ({ one }) => ({
  agent: one(agent, {
    fields: [agentCapabilityGrant.agentId],
    references: [agent.id],
  }),
  grantedByUser: one(user, {
    fields: [agentCapabilityGrant.grantedBy],
    references: [user.id],
    relationName: 'grantedAgentCapabilities',
  }),
  deniedByUser: one(user, {
    fields: [agentCapabilityGrant.deniedBy],
    references: [user.id],
    relationName: 'deniedAgentCapabilities',
  }),
}))

export const approvalRequestRelations = relations(approvalRequest, ({ one }) => ({
  agent: one(agent, {
    fields: [approvalRequest.agentId],
    references: [agent.id],
  }),
  host: one(agentHost, {
    fields: [approvalRequest.hostId],
    references: [agentHost.id],
  }),
  user: one(user, {
    fields: [approvalRequest.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const organizationRelations = relations(organization, ({ many, one }) => ({
  logoAsset: one(uploadedAsset, {
    fields: [organization.logoAssetId],
    references: [uploadedAsset.id],
  }),
  members: many(member),
  invitations: many(invitation),
  applications: many(application),
  roles: many(organizationRole),
  teams: many(team),
}))

export const organizationMemberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}))

export const organizationInvitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}))

export const organizationTeamRelations = relations(team, ({ many, one }) => ({
  organization: one(organization, {
    fields: [team.organizationId],
    references: [organization.id],
  }),
  members: many(teamMember),
}))

export const organizationTeamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
  user: one(user, {
    fields: [teamMember.userId],
    references: [user.id],
  }),
}))

export const applicationRelations = relations(application, ({ one, many }) => ({
  oauthClient: one(oauthClient, {
    fields: [application.oauthClientId],
    references: [oauthClient.clientId],
  }),
  ownerOrganization: one(organization, {
    fields: [application.ownerOrganizationId],
    references: [organization.id],
  }),
  logoAsset: one(uploadedAsset, {
    fields: [application.logoAssetId],
    references: [uploadedAsset.id],
  }),
  clientSecrets: many(applicationClientSecret),
  consents: many(applicationConsent),
  scopeEntitlements: many(resourceScopeEntitlement),
}))

export const apiResourceRelations = relations(apiResource, ({ many, one }) => ({
  ownerOrganization: one(organization, {
    fields: [apiResource.ownerOrganizationId],
    references: [organization.id],
  }),
  scopeEntitlements: many(resourceScopeEntitlement),
}))

export const resourceScopeEntitlementRelations = relations(resourceScopeEntitlement, ({ one }) => ({
  user: one(user, {
    fields: [resourceScopeEntitlement.userId],
    references: [user.id],
    relationName: 'entitlementSubjectUser',
  }),
  application: one(application, {
    fields: [resourceScopeEntitlement.applicationId],
    references: [application.id],
  }),
  resourceServer: one(apiResource, {
    fields: [resourceScopeEntitlement.resourceServerId],
    references: [apiResource.id],
  }),
  grantedByUser: one(user, {
    fields: [resourceScopeEntitlement.grantedByUserId],
    references: [user.id],
    relationName: 'entitlementGrantor',
  }),
  grantedByAgentIdentity: one(agentIdentity, {
    fields: [resourceScopeEntitlement.grantedByAgentIdentityId],
    references: [agentIdentity.id],
  }),
}))

export const organizationRoleRelations = relations(organizationRole, ({ one }) => ({
  organization: one(organization, {
    fields: [organizationRole.organizationId],
    references: [organization.id],
  }),
}))

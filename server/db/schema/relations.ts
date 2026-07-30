import { relations } from 'drizzle-orm'
import { agentIdentity } from './agent-identity-tables'
import { agentRoleAssignment } from './agent-role-tables'
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
  applicationRoleAssignment,
  invitation,
  member,
  memberRoleAssignment,
  organization,
  role,
  roleScope,
  userRoleAssignment,
} from './authorization-tables'

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
  roleAssignments: many(userRoleAssignment),
  agentHosts: many(agentHost),
  agents: many(agent),
  grantedAgentCapabilities: many(agentCapabilityGrant, { relationName: 'grantedAgentCapabilities' }),
  deniedAgentCapabilities: many(agentCapabilityGrant, { relationName: 'deniedAgentCapabilities' }),
  agentApprovalRequests: many(approvalRequest),
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
  roles: many(role),
}))

export const organizationMemberRelations = relations(member, ({ one, many }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
  roleAssignments: many(memberRoleAssignment),
}))

export const applicationRelations = relations(application, ({ one, many }) => ({
  oauthClient: one(oauthClient, {
    fields: [application.oauthClientId],
    references: [oauthClient.clientId],
  }),
  ownerUser: one(user, {
    fields: [application.ownerUserId],
    references: [user.id],
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
  roleAssignments: many(applicationRoleAssignment),
}))

export const apiResourceRelations = relations(apiResource, ({ many }) => ({
  roles: many(role),
}))

export const roleRelations = relations(role, ({ one, many }) => ({
  resource: one(apiResource, {
    fields: [role.resourceId],
    references: [apiResource.id],
  }),
  organization: one(organization, {
    fields: [role.organizationId],
    references: [organization.id],
  }),
  application: one(application, {
    fields: [role.applicationId],
    references: [application.id],
  }),
  scopes: many(roleScope),
  userAssignments: many(userRoleAssignment),
  applicationAssignments: many(applicationRoleAssignment),
  memberAssignments: many(memberRoleAssignment),
  agentAssignments: many(agentRoleAssignment),
}))

export const roleScopeRelations = relations(roleScope, ({ one }) => ({
  role: one(role, {
    fields: [roleScope.roleId],
    references: [role.id],
  }),
}))

export const agentRoleAssignmentRelations = relations(agentRoleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [agentRoleAssignment.roleId],
    references: [role.id],
  }),
  agentIdentity: one(agentIdentity, {
    fields: [agentRoleAssignment.agentIdentityId],
    references: [agentIdentity.id],
  }),
}))

export const userRoleAssignmentRelations = relations(userRoleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [userRoleAssignment.roleId],
    references: [role.id],
  }),
  user: one(user, {
    fields: [userRoleAssignment.userId],
    references: [user.id],
  }),
}))

export const applicationRoleAssignmentRelations = relations(applicationRoleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [applicationRoleAssignment.roleId],
    references: [role.id],
  }),
  application: one(application, {
    fields: [applicationRoleAssignment.applicationId],
    references: [application.id],
  }),
}))

export const memberRoleAssignmentRelations = relations(memberRoleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [memberRoleAssignment.roleId],
    references: [role.id],
  }),
  member: one(member, {
    fields: [memberRoleAssignment.memberId],
    references: [member.id],
  }),
}))

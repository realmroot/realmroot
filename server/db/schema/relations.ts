import { relations } from 'drizzle-orm'
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
  apiResourceEligibleOrganization,
  application,
  applicationAudienceOrganization,
  applicationAudienceUser,
  applicationClientSecret,
  applicationConsent,
  invitation,
  member,
  organization,
  organizationRole,
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
  roles: many(organizationRole),
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
  audienceOrganizations: many(applicationAudienceOrganization),
  audienceUsers: many(applicationAudienceUser),
}))

export const applicationAudienceOrganizationRelations = relations(applicationAudienceOrganization, ({ one }) => ({
  application: one(application, {
    fields: [applicationAudienceOrganization.applicationId],
    references: [application.id],
  }),
  organization: one(organization, {
    fields: [applicationAudienceOrganization.organizationId],
    references: [organization.id],
  }),
}))

export const applicationAudienceUserRelations = relations(applicationAudienceUser, ({ one }) => ({
  application: one(application, {
    fields: [applicationAudienceUser.applicationId],
    references: [application.id],
  }),
  user: one(user, {
    fields: [applicationAudienceUser.userId],
    references: [user.id],
  }),
}))

export const apiResourceRelations = relations(apiResource, ({ many, one }) => ({
  ownerOrganization: one(organization, {
    fields: [apiResource.ownerOrganizationId],
    references: [organization.id],
  }),
  eligibleOrganizations: many(apiResourceEligibleOrganization),
}))

export const apiResourceEligibleOrganizationRelations = relations(apiResourceEligibleOrganization, ({ one }) => ({
  resource: one(apiResource, {
    fields: [apiResourceEligibleOrganization.resourceId],
    references: [apiResource.id],
  }),
  organization: one(organization, {
    fields: [apiResourceEligibleOrganization.organizationId],
    references: [organization.id],
  }),
}))

export const organizationRoleRelations = relations(organizationRole, ({ one }) => ({
  organization: one(organization, {
    fields: [organizationRole.organizationId],
    references: [organization.id],
  }),
}))

import { conflict } from '@server/domain/errors'
import type { AuthorizationRepository, RoleAssignmentScope } from '@server/usecases/ports'
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import {
  agentAccessGrant,
  agentAccessRequest,
  agentAuditEvent,
  apiResource,
  apiResourceEligibleOrganization,
  externalTokenLease,
  federatedCredential,
  invitation,
  member,
  organization,
  resourceAccountConnection,
  resourceConnectionIntent,
  role,
  roleAssignment,
  rolePermission,
} from '../../db/schema'
import {
  toInvitation,
  toMember,
  toOrganization,
  toPagination,
  toResource,
  toRole,
  withoutUndefined,
} from './authorization-mappers'

export function createDrizzleAuthorizationRepository(db: Database): AuthorizationRepository {
  return {
    async createOrganization(input) {
      const now = new Date()
      await db.insert(organization).values({ ...input, createdAt: now, updatedAt: now })
      return { ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listOrganizations(pagination, organizationIds) {
      if (organizationIds?.length === 0) {
        return { items: [], pagination: toPagination(pagination, 0) }
      }
      const organizationCondition = organizationIds ? inArray(organization.id, organizationIds) : undefined
      const rows = await db
        .select()
        .from(organization)
        .where(organizationCondition)
        .orderBy(desc(organization.createdAt), desc(organization.id))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const totalResult = await db.select({ total: count() }).from(organization).where(organizationCondition)
      const total = totalResult[0]?.total ?? 0
      return { items: rows.map(toOrganization), pagination: toPagination(pagination, total) }
    },

    async findOrganization(id) {
      const rows = await db.select().from(organization).where(eq(organization.id, id)).limit(1)
      return rows[0] ? toOrganization(rows[0]) : null
    },

    async updateOrganization(id, patch) {
      await db
        .update(organization)
        .set({ ...withoutUndefined(patch), updatedAt: new Date() })
        .where(eq(organization.id, id))
    },

    async deleteOrganization(id) {
      await db.delete(organization).where(eq(organization.id, id))
    },

    async addMember(organizationId, input) {
      const now = new Date()
      await db.insert(member).values({ ...input, organizationId, createdAt: now, updatedAt: now })
      return { ...input, organizationId, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listMembers(organizationId, pagination) {
      const rows = await db
        .select()
        .from(member)
        .where(eq(member.organizationId, organizationId))
        .orderBy(desc(member.createdAt), desc(member.id))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const total = await totalRows(db, member, eq(member.organizationId, organizationId))
      return { items: rows.map(toMember), pagination: toPagination(pagination, total) }
    },

    async findMember(id) {
      const rows = await db.select().from(member).where(eq(member.id, id)).limit(1)
      return rows[0] ? toMember(rows[0]) : null
    },

    async findMemberByOrganizationUser(organizationId, userId) {
      const rows = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
        .limit(1)
      return rows[0] ? toMember(rows[0]) : null
    },

    async listUserMemberships(userId) {
      const rows = await db
        .select()
        .from(member)
        .where(eq(member.userId, userId))
        .orderBy(desc(member.createdAt), desc(member.id))
      return rows.map(toMember)
    },

    async listMemberUserIds(organizationIds) {
      if (organizationIds.length === 0) return []
      const rows = await db
        .selectDistinct({ userId: member.userId })
        .from(member)
        .where(inArray(member.organizationId, organizationIds))
      return rows.map((row) => row.userId)
    },

    async countMembersByRole(organizationId, roleName) {
      const [result] = await db
        .select({ value: count() })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.role, roleName)))
      return result?.value ?? 0
    },

    async hasPendingInvitation(email, now) {
      const rows = await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(and(eq(invitation.email, email), eq(invitation.status, 'pending'), gt(invitation.expiresAt, now)))
        .limit(1)
      return rows.length > 0
    },

    async updateMember(id, patch) {
      await db
        .update(member)
        .set({ ...withoutUndefined(patch), updatedAt: new Date() })
        .where(eq(member.id, id))
    },

    async removeMember(id) {
      await db.delete(member).where(eq(member.id, id))
    },

    async createInvitation(input, audit) {
      const now = new Date()
      const expiresAt = new Date(input.expiresAt)
      await db.batch([
        db.insert(invitation).values({ ...input, expiresAt, createdAt: now }),
        db.insert(agentAuditEvent).values(audit),
      ])
      return {
        ...input,
        expiresAt: expiresAt.toISOString(),
        acceptedAt: null,
        revokedAt: null,
        createdAt: now.toISOString(),
      }
    },

    async listInvitations(organizationId, pagination) {
      const rows = await db
        .select()
        .from(invitation)
        .where(eq(invitation.organizationId, organizationId))
        .orderBy(desc(invitation.createdAt), desc(invitation.id))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const total = await totalRows(db, invitation, eq(invitation.organizationId, organizationId))
      return { items: rows.map(toInvitation), pagination: toPagination(pagination, total) }
    },

    async findInvitation(id) {
      const rows = await db.select().from(invitation).where(eq(invitation.id, id)).limit(1)
      return rows[0] ? toInvitation(rows[0]) : null
    },

    async cancelInvitation(id) {
      await db.update(invitation).set({ status: 'canceled', revokedAt: new Date() }).where(eq(invitation.id, id))
    },

    async createResource(input, audit) {
      const now = new Date()
      const { accessEligibility, ...resource } = input
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db.insert(apiResource).values({
          ...resource,
          accessEligibilityMode: accessEligibility.mode,
          createdAt: now,
          updatedAt: now,
        }),
      ]
      if (accessEligibility.organizationIds.length > 0) {
        statements.push(
          db.insert(apiResourceEligibleOrganization).values(
            accessEligibility.organizationIds.map((organizationId) => ({
              resourceId: input.id,
              organizationId,
            })),
          ),
        )
      }
      if (audit) statements.push(db.insert(agentAuditEvent).values(audit))
      await db.batch(statements)
      return { ...input, archivedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listResources(pagination, ownerOrganizationIds) {
      if (ownerOrganizationIds?.length === 0) {
        return { items: [], pagination: toPagination(pagination, 0) }
      }
      const ownerCondition = ownerOrganizationIds
        ? inArray(apiResource.ownerOrganizationId, ownerOrganizationIds)
        : undefined
      const rows = await db
        .select()
        .from(apiResource)
        .where(ownerCondition)
        .orderBy(desc(apiResource.createdAt), desc(apiResource.id))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const totalResult = await db.select({ total: count() }).from(apiResource).where(ownerCondition)
      const total = totalResult[0]?.total ?? 0
      const eligibility = await loadResourceEligibility(
        db,
        rows.map((row) => row.id),
      )
      return {
        items: rows.map((row) => toResource(row, eligibility.get(row.id))),
        pagination: toPagination(pagination, total),
      }
    },

    async listEnabledResources() {
      const rows = await db
        .select()
        .from(apiResource)
        .where(and(eq(apiResource.enabled, true), isNull(apiResource.archivedAt)))
        .orderBy(desc(apiResource.createdAt), desc(apiResource.id))
      const eligibility = await loadResourceEligibility(
        db,
        rows.map((row) => row.id),
      )
      return rows.map((row) => toResource(row, eligibility.get(row.id)))
    },

    async findResource(id) {
      const rows = await db.select().from(apiResource).where(eq(apiResource.id, id)).limit(1)
      const row = rows[0]
      if (!row) return null
      const eligibility = await loadResourceEligibility(db, [row.id])
      return toResource(row, eligibility.get(row.id))
    },

    async findResourceByResourceUrl(resourceUrl) {
      const rows = await db
        .select()
        .from(apiResource)
        .where(and(eq(apiResource.resourceUrl, resourceUrl), eq(apiResource.enabled, true)))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      const eligibility = await loadResourceEligibility(db, [row.id])
      return toResource(row, eligibility.get(row.id))
    },

    async updateResource(id, patch) {
      const { accessEligibility, ...resourcePatch } = patch
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db
          .update(apiResource)
          .set({
            ...withoutUndefined(resourcePatch),
            ...(accessEligibility ? { accessEligibilityMode: accessEligibility.mode } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(apiResource.id, id), isNull(apiResource.archivedAt)))
          .returning({ id: apiResource.id }),
      ]
      if (accessEligibility) {
        statements.push(
          db.delete(apiResourceEligibleOrganization).where(eq(apiResourceEligibleOrganization.resourceId, id)),
        )
        if (accessEligibility.organizationIds.length > 0) {
          statements.push(
            db
              .insert(apiResourceEligibleOrganization)
              .values(accessEligibility.organizationIds.map((organizationId) => ({ resourceId: id, organizationId }))),
          )
        }
      }
      const [rows] = await db.batch(statements)
      return rows.length > 0
    },

    async archiveResource(id, now, audit) {
      await db.batch([
        db.insert(agentAuditEvent).select(
          db
            .select({
              id: sql<string>`${audit.id}`.as('id'),
              action: sql<string>`${audit.action}`.as('action'),
              result: sql<string>`${audit.result}`.as('result'),
              controllerUserId: sql<string | null>`${audit.controllerUserId}`.as('controller_user_id'),
              subjectIssuer: sql<string | null>`${audit.subjectIssuer}`.as('subject_issuer'),
              subject: sql<string | null>`${audit.subject}`.as('subject'),
              agentIdentityId: sql<string | null>`${audit.agentIdentityId}`.as('agent_identity_id'),
              hostId: sql<string | null>`${audit.hostId}`.as('host_id'),
              ownerUserId: sql<string | null>`${audit.ownerUserId}`.as('owner_user_id'),
              ownerOrganizationId: sql<string | null>`${audit.ownerOrganizationId}`.as('owner_organization_id'),
              resourceId: apiResource.id,
              resourceConnectionId: sql<string | null>`${audit.resourceConnectionId}`.as('resource_connection_id'),
              accessGrantId: sql<string | null>`${audit.accessGrantId}`.as('access_grant_id'),
              scopes: sql<string[] | null>`${audit.scopes === null ? null : JSON.stringify(audit.scopes)}`.as('scopes'),
              reasonCode: sql<string | null>`${audit.reasonCode}`.as('reason_code'),
              metadata: sql<Record<string, unknown> | null>`${
                audit.metadata === null ? null : JSON.stringify(audit.metadata)
              }`.as('metadata'),
              occurredAt: sql<Date>`${audit.occurredAt.getTime()}`.as('occurred_at'),
            })
            .from(apiResource)
            .where(and(eq(apiResource.id, id), isNull(apiResource.archivedAt))),
        ),
        db
          .update(apiResource)
          .set({ enabled: false, archivedAt: now, updatedAt: now })
          .where(and(eq(apiResource.id, id), isNull(apiResource.archivedAt))),
        db
          .update(resourceAccountConnection)
          .set({ status: 'revoked', revokedAt: now, updatedAt: now })
          .where(and(eq(resourceAccountConnection.resourceId, id), eq(resourceAccountConnection.status, 'active'))),
        db
          .update(resourceConnectionIntent)
          .set({ status: 'cancelled', completedAt: now, updatedAt: now })
          .where(and(eq(resourceConnectionIntent.resourceId, id), eq(resourceConnectionIntent.status, 'pending'))),
        db
          .update(agentAccessRequest)
          .set({ status: 'denied', decidedAt: now, updatedAt: now })
          .where(and(eq(agentAccessRequest.resourceId, id), eq(agentAccessRequest.status, 'pending'))),
        db
          .update(agentAccessGrant)
          .set({ status: 'revoked', revokedAt: now, updatedAt: now })
          .where(and(eq(agentAccessGrant.resourceId, id), eq(agentAccessGrant.status, 'active'))),
        db
          .update(externalTokenLease)
          .set({ revokedAt: now })
          .where(
            and(
              isNull(externalTokenLease.revokedAt),
              inArray(
                externalTokenLease.grantId,
                db
                  .select({ id: agentAccessGrant.id })
                  .from(agentAccessGrant)
                  .where(eq(agentAccessGrant.resourceId, id)),
              ),
            ),
          ),
      ])
    },

    async restoreResource(id, now, audit) {
      await db.batch([
        db.insert(agentAuditEvent).select(
          db
            .select({
              id: sql<string>`${audit.id}`.as('id'),
              action: sql<string>`${audit.action}`.as('action'),
              result: sql<string>`${audit.result}`.as('result'),
              controllerUserId: sql<string | null>`${audit.controllerUserId}`.as('controller_user_id'),
              subjectIssuer: sql<string | null>`${audit.subjectIssuer}`.as('subject_issuer'),
              subject: sql<string | null>`${audit.subject}`.as('subject'),
              agentIdentityId: sql<string | null>`${audit.agentIdentityId}`.as('agent_identity_id'),
              hostId: sql<string | null>`${audit.hostId}`.as('host_id'),
              ownerUserId: sql<string | null>`${audit.ownerUserId}`.as('owner_user_id'),
              ownerOrganizationId: sql<string | null>`${audit.ownerOrganizationId}`.as('owner_organization_id'),
              resourceId: apiResource.id,
              resourceConnectionId: sql<string | null>`${audit.resourceConnectionId}`.as('resource_connection_id'),
              accessGrantId: sql<string | null>`${audit.accessGrantId}`.as('access_grant_id'),
              scopes: sql<string[] | null>`${audit.scopes === null ? null : JSON.stringify(audit.scopes)}`.as('scopes'),
              reasonCode: sql<string | null>`${audit.reasonCode}`.as('reason_code'),
              metadata: sql<Record<string, unknown> | null>`${
                audit.metadata === null ? null : JSON.stringify(audit.metadata)
              }`.as('metadata'),
              occurredAt: sql<Date>`${audit.occurredAt.getTime()}`.as('occurred_at'),
            })
            .from(apiResource)
            .where(and(eq(apiResource.id, id), isNotNull(apiResource.archivedAt))),
        ),
        db
          .update(apiResource)
          .set({ enabled: false, archivedAt: null, updatedAt: now })
          .where(and(eq(apiResource.id, id), isNotNull(apiResource.archivedAt))),
      ])
    },

    async deleteResource(id) {
      const deleted = await db
        .delete(apiResource)
        .where(
          and(
            eq(apiResource.id, id),
            notExists(
              db
                .select({ id: federatedCredential.id })
                .from(federatedCredential)
                .where(eq(federatedCredential.audienceResourceId, id)),
            ),
            notExists(
              db
                .select({ id: resourceAccountConnection.id })
                .from(resourceAccountConnection)
                .where(eq(resourceAccountConnection.resourceId, id)),
            ),
            notExists(
              db
                .select({ id: resourceConnectionIntent.id })
                .from(resourceConnectionIntent)
                .where(eq(resourceConnectionIntent.resourceId, id)),
            ),
            notExists(
              db
                .select({ id: agentAccessRequest.id })
                .from(agentAccessRequest)
                .where(eq(agentAccessRequest.resourceId, id)),
            ),
            notExists(
              db.select({ id: agentAccessGrant.id }).from(agentAccessGrant).where(eq(agentAccessGrant.resourceId, id)),
            ),
          ),
        )
        .returning({ id: apiResource.id })

      if (deleted.length > 0) return null

      const [references] = await db
        .select({
          federatedCredentials: sql<number>`(
            SELECT COUNT(*) FROM ${federatedCredential}
            WHERE ${federatedCredential.audienceResourceId} = ${id}
          )`,
          accountConnections: sql<number>`(
            SELECT COUNT(*) FROM ${resourceAccountConnection}
            WHERE ${resourceAccountConnection.resourceId} = ${id}
          )`,
          connectionIntents: sql<number>`(
            SELECT COUNT(*) FROM ${resourceConnectionIntent}
            WHERE ${resourceConnectionIntent.resourceId} = ${id}
          )`,
          agentAccessRequests: sql<number>`(
            SELECT COUNT(*) FROM ${agentAccessRequest}
            WHERE ${agentAccessRequest.resourceId} = ${id}
          )`,
          agentAccessGrants: sql<number>`(
            SELECT COUNT(*) FROM ${agentAccessGrant}
            WHERE ${agentAccessGrant.resourceId} = ${id}
          )`,
        })
        .from(apiResource)
        .where(eq(apiResource.id, id))

      if (!references) throw new Error(`API resource ${id} disappeared during deletion.`)
      return references
    },

    async createRole(input) {
      const now = new Date()
      try {
        await db.insert(role).values({ ...input, createdAt: now, updatedAt: now })
      } catch (error) {
        if (isUniqueConstraint(error)) throw conflict(`Role key "${input.key}" is already in use.`)
        throw error
      }
      return { ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listRoles(pagination) {
      const rows = await db
        .select()
        .from(role)
        .orderBy(desc(role.createdAt), desc(role.id))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const total = await totalRows(db, role)
      return { items: rows.map(toRole), pagination: toPagination(pagination, total) }
    },

    async findRole(id) {
      const rows = await db.select().from(role).where(eq(role.id, id)).limit(1)
      return rows[0] ? toRole(rows[0]) : null
    },

    async updateRole(id, patch) {
      await db
        .update(role)
        .set({ ...withoutUndefined(patch), updatedAt: new Date() })
        .where(eq(role.id, id))
    },

    async deleteRole(id) {
      await db.delete(role).where(eq(role.id, id))
    },

    async listRolePermissions(roleId) {
      return db
        .select({ resourceId: rolePermission.resourceId, scope: rolePermission.scope })
        .from(rolePermission)
        .where(eq(rolePermission.roleId, roleId))
        .orderBy(rolePermission.resourceId, rolePermission.scope)
    },

    async replaceRolePermissions(roleId, permissions) {
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db.delete(rolePermission).where(eq(rolePermission.roleId, roleId)),
      ]
      if (permissions.length > 0) {
        statements.push(db.insert(rolePermission).values(permissions.map((permission) => ({ roleId, ...permission }))))
      }
      await db.batch(statements)
    },

    async listRoleAssignments(query) {
      const now = new Date()
      const conditions = [
        query.roleId ? eq(roleAssignment.roleId, query.roleId) : undefined,
        query.subjectType ? eq(roleAssignment.subjectType, query.subjectType) : undefined,
        query.subjectId ? eq(roleAssignment.subjectId, query.subjectId) : undefined,
        query.organizationId ? eq(roleAssignment.organizationId, query.organizationId) : undefined,
        query.organizationIds
          ? query.includeRealmAssignments
            ? or(isNull(roleAssignment.organizationId), inArray(roleAssignment.organizationId, query.organizationIds))
            : inArray(roleAssignment.organizationId, query.organizationIds)
          : undefined,
        query.contextualOrganizationId
          ? or(isNull(roleAssignment.organizationId), eq(roleAssignment.organizationId, query.contextualOrganizationId))
          : undefined,
        query.context === 'realm' ? isNull(roleAssignment.organizationId) : undefined,
        query.context === 'organization' ? isNotNull(roleAssignment.organizationId) : undefined,
        query.status === 'revoked' ? isNotNull(roleAssignment.revokedAt) : undefined,
        query.status === 'expired'
          ? and(isNull(roleAssignment.revokedAt), lte(roleAssignment.expiresAt, now))
          : undefined,
        query.status === 'active'
          ? and(
              isNull(roleAssignment.revokedAt),
              or(isNull(roleAssignment.expiresAt), gt(roleAssignment.expiresAt, now)),
            )
          : undefined,
      ].filter((condition) => condition !== undefined)
      const where = conditions.length ? and(...conditions) : undefined
      const rows = await db
        .select()
        .from(roleAssignment)
        .where(where)
        .orderBy(desc(roleAssignment.createdAt), desc(roleAssignment.id))
        .limit(query.limit)
        .offset(query.offset)
      const total = await totalRows(db, roleAssignment, where)
      return { items: rows.map(toRoleAssignment), pagination: toPagination(query, total) }
    },

    async countEffectiveAgentRoles(agents) {
      if (agents.length === 0) return new Map()
      const now = new Date()
      const rows = await db
        .select({
          agentIdentityId: roleAssignment.subjectId,
          organizationId: roleAssignment.organizationId,
          roleId: roleAssignment.roleId,
        })
        .from(roleAssignment)
        .where(
          and(
            eq(roleAssignment.subjectType, 'agent'),
            inArray(
              roleAssignment.subjectId,
              agents.map((agent) => agent.agentIdentityId),
            ),
            isNull(roleAssignment.revokedAt),
            or(isNull(roleAssignment.expiresAt), gt(roleAssignment.expiresAt, now)),
          ),
        )
      const organizationByAgent = new Map(agents.map((agent) => [agent.agentIdentityId, agent.organizationId]))
      const rolesByAgent = new Map(agents.map((agent) => [agent.agentIdentityId, new Set<string>()]))
      for (const row of rows) {
        const organizationId = organizationByAgent.get(row.agentIdentityId)
        if (row.organizationId === null || row.organizationId === organizationId) {
          rolesByAgent.get(row.agentIdentityId)!.add(row.roleId)
        }
      }
      return new Map([...rolesByAgent].map(([agentIdentityId, roles]) => [agentIdentityId, roles.size]))
    },

    async findRoleAssignment(id) {
      const rows = await db.select().from(roleAssignment).where(eq(roleAssignment.id, id)).limit(1)
      return rows[0] ? toRoleAssignment(rows[0]) : null
    },

    async createRoleAssignment(input, audit) {
      const now = new Date()
      const row = {
        ...input,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      try {
        await db.batch([db.insert(roleAssignment).values(row), db.insert(agentAuditEvent).values(audit)])
      } catch (error) {
        if (isUniqueConstraint(error)) throw conflict('An active Role assignment already exists for this context.')
        throw error
      }
      return toRoleAssignment(row)
    },

    async revokeRoleAssignment(id, revokedAt) {
      const [row] = await db
        .update(roleAssignment)
        .set({ revokedAt, updatedAt: revokedAt })
        .where(and(eq(roleAssignment.id, id), isNull(roleAssignment.revokedAt)))
        .returning({ id: roleAssignment.id })
      return Boolean(row)
    },

    listUserRoleAssignments(userId, scope) {
      return listContextualAssignments(db, 'user', userId, scope)
    },

    listApplicationRoleAssignments(applicationId, scope) {
      return listContextualAssignments(db, 'workload', applicationId, scope)
    },

    listAgentRoleAssignments(agentIdentityId, scope) {
      return listContextualAssignments(db, 'agent', agentIdentityId, scope)
    },
  }
}

function isUniqueConstraint(error: unknown) {
  let current = error
  while (current instanceof Error) {
    if (/unique constraint/i.test(current.message)) return true
    current = current.cause
  }
  return false
}

async function loadResourceEligibility(db: Database, resourceIds: string[]) {
  const eligibility = new Map<string, string[]>()
  for (const id of resourceIds) eligibility.set(id, [])
  if (resourceIds.length === 0) return eligibility
  const rows = await db
    .select({
      resourceId: apiResourceEligibleOrganization.resourceId,
      organizationId: apiResourceEligibleOrganization.organizationId,
    })
    .from(apiResourceEligibleOrganization)
    .where(inArray(apiResourceEligibleOrganization.resourceId, resourceIds))
  for (const row of rows) eligibility.get(row.resourceId)?.push(row.organizationId)
  return eligibility
}

async function listContextualAssignments(
  db: Database,
  subjectType: 'user' | 'agent' | 'workload',
  subjectId: string,
  scope: RoleAssignmentScope,
) {
  const now = new Date()
  const rows = await db
    .select({ role })
    .from(roleAssignment)
    .innerJoin(role, eq(roleAssignment.roleId, role.id))
    .where(
      and(
        eq(roleAssignment.subjectType, subjectType),
        eq(roleAssignment.subjectId, subjectId),
        isNull(roleAssignment.revokedAt),
        or(isNull(roleAssignment.expiresAt), gt(roleAssignment.expiresAt, now)),
        scope.organizationId
          ? or(eq(roleAssignment.organizationId, scope.organizationId), isNull(roleAssignment.organizationId))
          : isNull(roleAssignment.organizationId),
      ),
    )

  const assignments = new Map(rows.map((row) => [row.role.id, { role: toRole(row.role), scopes: [] as string[] }]))
  if (!scope.resourceId || assignments.size === 0) return [...assignments.values()]
  const permissions = await db
    .select({ roleId: rolePermission.roleId, scope: rolePermission.scope })
    .from(rolePermission)
    .where(
      and(inArray(rolePermission.roleId, [...assignments.keys()]), eq(rolePermission.resourceId, scope.resourceId)),
    )
  for (const permission of permissions) {
    assignments.get(permission.roleId)?.scopes.push(permission.scope)
  }
  return [...assignments.values()].filter((assignment) => assignment.scopes.length > 0)
}

async function totalRows(
  db: Database,
  table: Parameters<ReturnType<Database['select']>['from']>[0],
  where?: ReturnType<typeof eq> | ReturnType<typeof and>,
) {
  const query = db.select({ total: count() }).from(table)
  const rows = where ? await query.where(where) : await query
  return rows[0]?.total ?? 0
}

function toRoleAssignment(row: typeof roleAssignment.$inferSelect) {
  return {
    id: row.id,
    roleId: row.roleId,
    subjectType: row.subjectType as 'user' | 'agent' | 'workload',
    subjectId: row.subjectId,
    organizationId: row.organizationId,
    assignedByUserId: row.assignedByUserId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

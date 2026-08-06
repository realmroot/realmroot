import { conflict } from '@server/domain/errors'
import { platformOrganization } from '@server/domain/platform-organization'
import type { AuthorizationRepository } from '@server/usecases/ports'
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, ne, notExists, sql } from 'drizzle-orm'
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
  organizationRole,
  resourceAccountConnection,
  resourceConnectionIntent,
} from '../../db/schema'
import {
  serializeRoles,
  toInvitation,
  toMember,
  toOrganization,
  toOrganizationRole,
  toPagination,
  toResource,
  withoutUndefined,
} from './authorization-mappers'

export function createDrizzleAuthorizationRepository(db: Database): AuthorizationRepository {
  return {
    async createOrganization(input, owner) {
      const now = new Date()
      const { roles, ...ownerRecord } = owner
      await db.batch([
        db.insert(organization).values({ ...input, createdAt: now, updatedAt: now }),
        db.insert(member).values({
          ...ownerRecord,
          organizationId: input.id,
          role: serializeRoles(roles),
          createdAt: now,
          updatedAt: now,
        }),
      ])
      return { ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listOrganizations(pagination, organizationIds) {
      if (organizationIds?.length === 0) {
        return { items: [], pagination: toPagination(pagination, 0) }
      }
      const organizationCondition = and(
        ne(organization.id, platformOrganization.id),
        organizationIds ? inArray(organization.id, organizationIds) : undefined,
      )
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
      const { roles, ...record } = input
      await db
        .insert(member)
        .values({ ...record, role: serializeRoles(roles), organizationId, createdAt: now, updatedAt: now })
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
        .where(and(eq(member.userId, userId), ne(member.organizationId, platformOrganization.id)))
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
        .where(
          and(eq(member.organizationId, organizationId), sql`(',' || ${member.role} || ',') like ${`%,${roleName},%`}`),
        )
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

    async replaceMemberRoles(organizationId, memberId, roles, expectedUpdatedAt, audit) {
      const expected = new Date(expectedUpdatedAt)
      const now = audit.occurredAt
      const lastOwnerGuard = roles.includes('owner')
        ? undefined
        : sql`(
            (',' || ${member.role} || ',') not like '%,owner,%'
            or exists (
              select 1 from ${member} as other
              where other.organization_id = ${organizationId}
                and other.id <> ${memberId}
                and (',' || other.role || ',') like '%,owner,%'
            )
          )`
      const condition = and(
        eq(member.id, memberId),
        eq(member.organizationId, organizationId),
        eq(member.updatedAt, expected),
        lastOwnerGuard,
      )
      const [, updated] = await db.batch([
        db
          .insert(agentAuditEvent)
          .select(db.select(auditSelect(audit, { organizationId, memberId, roles })).from(member).where(condition)),
        db
          .update(member)
          .set({ role: serializeRoles(roles), updatedAt: now })
          .where(condition)
          .returning({ id: member.id }),
      ])
      return updated.length > 0
    },

    async removeMember(organizationId, memberId, expectedUpdatedAt, audit) {
      const expected = new Date(expectedUpdatedAt)
      const condition = and(
        eq(member.id, memberId),
        eq(member.organizationId, organizationId),
        eq(member.updatedAt, expected),
        sql`(
          (',' || ${member.role} || ',') not like '%,owner,%'
          or exists (
            select 1 from ${member} as other
            where other.organization_id = ${organizationId}
              and other.id <> ${memberId}
              and (',' || other.role || ',') like '%,owner,%'
          )
        )`,
      )
      const [, removed] = await db.batch([
        db
          .insert(agentAuditEvent)
          .select(db.select(auditSelect(audit, { organizationId, memberId })).from(member).where(condition)),
        db.delete(member).where(condition).returning({ id: member.id }),
      ])
      return removed.length > 0
    },

    async createInvitation(input) {
      const now = new Date()
      const expiresAt = new Date(input.expiresAt)
      const { roles, ...record } = input
      await db.insert(invitation).values({ ...record, role: serializeRoles(roles), expiresAt, createdAt: now })
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

    async createResource(input) {
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
              realmOwned: sql<boolean>`${audit.realmOwned}`.as('realm_owned'),
              ownerUserId: sql<string | null>`${audit.ownerUserId}`.as('owner_user_id'),
              ownerOrganizationId: sql<string | null>`${audit.ownerOrganizationId}`.as('owner_organization_id'),
              controllerUserId: sql<string | null>`${audit.controllerUserId}`.as('controller_user_id'),
              subjectIssuer: sql<string | null>`${audit.subjectIssuer}`.as('subject_issuer'),
              subject: sql<string | null>`${audit.subject}`.as('subject'),
              agentIdentityId: sql<string | null>`${audit.agentIdentityId}`.as('agent_identity_id'),
              hostId: sql<string | null>`${audit.hostId}`.as('host_id'),
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
              realmOwned: sql<boolean>`${audit.realmOwned}`.as('realm_owned'),
              ownerUserId: sql<string | null>`${audit.ownerUserId}`.as('owner_user_id'),
              ownerOrganizationId: sql<string | null>`${audit.ownerOrganizationId}`.as('owner_organization_id'),
              controllerUserId: sql<string | null>`${audit.controllerUserId}`.as('controller_user_id'),
              subjectIssuer: sql<string | null>`${audit.subjectIssuer}`.as('subject_issuer'),
              subject: sql<string | null>`${audit.subject}`.as('subject'),
              agentIdentityId: sql<string | null>`${audit.agentIdentityId}`.as('agent_identity_id'),
              hostId: sql<string | null>`${audit.hostId}`.as('host_id'),
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

    async createOrganizationRole(organizationId, input, permission, audit) {
      const now = audit.occurredAt
      const row = {
        id: `org-role_${crypto.randomUUID()}`,
        organizationId,
        role: input.key,
        permission,
        displayName: input.displayName,
        description: input.description,
        createdAt: now,
        updatedAt: now,
      }
      try {
        await db.batch([db.insert(organizationRole).values(row), db.insert(agentAuditEvent).values(audit)])
      } catch (error) {
        if (isUniqueConstraint(error)) throw conflict(`Role key "${input.key}" is already in use.`)
        throw error
      }
      return { ...input, predefined: false, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listOrganizationRoles(organizationId) {
      const rows = await db
        .select()
        .from(organizationRole)
        .where(eq(organizationRole.organizationId, organizationId))
        .orderBy(organizationRole.role)
      return rows.map(toOrganizationRole)
    },

    async findOrganizationRole(organizationId, roleKey) {
      const [row] = await db
        .select()
        .from(organizationRole)
        .where(and(eq(organizationRole.organizationId, organizationId), eq(organizationRole.role, roleKey)))
        .limit(1)
      return row ? toOrganizationRole(row) : null
    },

    async listOrganizationRoleScopes(organizationId) {
      const rows = await db
        .select({ role: organizationRole.role, permission: organizationRole.permission })
        .from(organizationRole)
        .where(eq(organizationRole.organizationId, organizationId))
      return new Map(rows.map((row) => [row.role, decodePermissionScopes(row.permission)]))
    },

    async updateOrganizationRole(organizationId, roleKey, patch, permission, expectedUpdatedAt, audit) {
      const condition = and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.role, roleKey),
        eq(organizationRole.updatedAt, new Date(expectedUpdatedAt)),
      )
      const [, updated] = await db.batch([
        db
          .insert(agentAuditEvent)
          .select(db.select(auditSelect(audit, { organizationId, roleKey })).from(organizationRole).where(condition)),
        db
          .update(organizationRole)
          .set({
            ...withoutUndefined({
              displayName: patch.displayName,
              description: patch.description,
              permission,
            }),
            updatedAt: audit.occurredAt,
          })
          .where(condition)
          .returning({ id: organizationRole.id }),
      ])
      return updated.length > 0
    },

    async deleteOrganizationRole(organizationId, roleKey, expectedUpdatedAt, audit) {
      const assignedMember = sql`(',' || ${member.role} || ',') like ${`%,${roleKey},%`}`
      const assignedInvitation = sql`(',' || ${invitation.role} || ',') like ${`%,${roleKey},%`}`
      const condition = and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.role, roleKey),
        eq(organizationRole.updatedAt, new Date(expectedUpdatedAt)),
        notExists(
          db
            .select({ id: member.id })
            .from(member)
            .where(and(eq(member.organizationId, organizationId), assignedMember)),
        ),
        notExists(
          db
            .select({ id: invitation.id })
            .from(invitation)
            .where(
              and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending'), assignedInvitation),
            ),
        ),
      )
      const [, deleted] = await db.batch([
        db
          .insert(agentAuditEvent)
          .select(db.select(auditSelect(audit, { organizationId, roleKey })).from(organizationRole).where(condition)),
        db.delete(organizationRole).where(condition).returning({ id: organizationRole.id }),
      ])
      if (deleted.length > 0) return 'deleted'
      const [existing] = await db
        .select({ id: organizationRole.id })
        .from(organizationRole)
        .where(and(eq(organizationRole.organizationId, organizationId), eq(organizationRole.role, roleKey)))
        .limit(1)
      if (!existing) return 'not_found'
      const [assignment] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), assignedMember))
        .limit(1)
      if (assignment) return 'assigned'
      const [pendingInvitation] = await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending'), assignedInvitation))
        .limit(1)
      return pendingInvitation ? 'assigned' : 'not_found'
    },
  }
}

function isUniqueConstraint(error: unknown) {
  let current = error
  while (current instanceof Error) {
    if (/unique constraint|SQLITE_CONSTRAINT/i.test(current.message)) return true
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

function decodePermissionScopes(permission: Record<string, string[]>) {
  return (permission.scope ?? []).flatMap((value) => {
    const separator = value.indexOf('/')
    if (separator < 1 || separator === value.length - 1) return []
    try {
      return [
        {
          resourceId: decodeURIComponent(value.slice(0, separator)),
          scope: decodeURIComponent(value.slice(separator + 1)),
        },
      ]
    } catch {
      return []
    }
  })
}

function auditSelect(audit: import('@server/usecases/ports').AgentAuditEventRecord, metadata: Record<string, unknown>) {
  return {
    id: sql<string>`${audit.id}`.as('id'),
    action: sql<string>`${audit.action}`.as('action'),
    result: sql<string>`${audit.result}`.as('result'),
    realmOwned: sql<boolean>`${audit.realmOwned}`.as('realm_owned'),
    ownerUserId: sql<string | null>`${audit.ownerUserId}`.as('owner_user_id'),
    ownerOrganizationId: sql<string | null>`${audit.ownerOrganizationId}`.as('owner_organization_id'),
    controllerUserId: sql<string | null>`${audit.controllerUserId}`.as('controller_user_id'),
    subjectIssuer: sql<string | null>`${audit.subjectIssuer}`.as('subject_issuer'),
    subject: sql<string | null>`${audit.subject}`.as('subject'),
    agentIdentityId: sql<string | null>`${audit.agentIdentityId}`.as('agent_identity_id'),
    hostId: sql<string | null>`${audit.hostId}`.as('host_id'),
    resourceId: sql<string | null>`${audit.resourceId}`.as('resource_id'),
    resourceConnectionId: sql<string | null>`${audit.resourceConnectionId}`.as('resource_connection_id'),
    accessGrantId: sql<string | null>`${audit.accessGrantId}`.as('access_grant_id'),
    scopes: sql<string[] | null>`${audit.scopes === null ? null : JSON.stringify(audit.scopes)}`.as('scopes'),
    reasonCode: sql<string | null>`${audit.reasonCode}`.as('reason_code'),
    metadata: sql<Record<string, unknown>>`${JSON.stringify({ ...audit.metadata, ...metadata })}`.as('metadata'),
    occurredAt: sql<Date>`${audit.occurredAt.getTime()}`.as('occurred_at'),
  }
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

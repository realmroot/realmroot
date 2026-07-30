import type { AuthorizationRepository, RoleAssignmentScope } from '@server/usecases/ports'
import { and, count, desc, eq, gt, isNull, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import {
  agentRoleAssignment,
  apiResource,
  applicationRoleAssignment,
  invitation,
  member,
  memberRoleAssignment,
  organization,
  role,
  roleScope,
  userRoleAssignment,
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

    async listOrganizations(pagination) {
      const rows = await db
        .select()
        .from(organization)
        .orderBy(desc(organization.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const total = await totalRows(db, organization)
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
        .orderBy(desc(member.createdAt))
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

    async updateMember(id, patch) {
      await db
        .update(member)
        .set({ ...withoutUndefined(patch), updatedAt: new Date() })
        .where(eq(member.id, id))
    },

    async removeMember(id) {
      await db.delete(member).where(eq(member.id, id))
    },

    async createInvitation(input) {
      const now = new Date()
      const expiresAt = new Date(input.expiresAt)
      await db.insert(invitation).values({ ...input, expiresAt, createdAt: now })
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
        .orderBy(desc(invitation.createdAt))
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
      await db.insert(apiResource).values({ ...input, createdAt: now, updatedAt: now })
      return { ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listResources(pagination) {
      const rows = await db
        .select()
        .from(apiResource)
        .orderBy(desc(apiResource.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const total = await totalRows(db, apiResource)
      return { items: rows.map(toResource), pagination: toPagination(pagination, total) }
    },

    async findResource(id) {
      const rows = await db.select().from(apiResource).where(eq(apiResource.id, id)).limit(1)
      return rows[0] ? toResource(rows[0]) : null
    },

    async findResourceByAudience(audience) {
      const rows = await db
        .select()
        .from(apiResource)
        .where(and(eq(apiResource.audience, audience), eq(apiResource.enabled, true)))
        .limit(1)
      return rows[0] ? toResource(rows[0]) : null
    },

    async updateResource(id, patch) {
      await db
        .update(apiResource)
        .set({ ...withoutUndefined(patch), updatedAt: new Date() })
        .where(eq(apiResource.id, id))
    },

    async deleteResource(id) {
      await db.delete(apiResource).where(eq(apiResource.id, id))
    },

    async createRole(input) {
      const now = new Date()
      await db.insert(role).values({ ...input, createdAt: now, updatedAt: now })
      return { ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    },

    async listRoles(pagination) {
      const rows = await db
        .select()
        .from(role)
        .orderBy(desc(role.createdAt))
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

    async listRoleScopes(roleId) {
      const rows = await db.select({ scope: roleScope.scope }).from(roleScope).where(eq(roleScope.roleId, roleId))
      return rows.map((row) => row.scope).sort()
    },

    async replaceRoleScopes(roleId, scopes) {
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db.delete(roleScope).where(eq(roleScope.roleId, roleId)),
      ]
      if (scopes.length > 0) {
        statements.push(db.insert(roleScope).values(scopes.map((scope) => ({ roleId, scope }))))
      }
      await db.batch(statements)
    },

    async assignUserRole(input) {
      await db
        .insert(userRoleAssignment)
        .values({
          id: input.id,
          roleId: input.roleId,
          userId: input.subjectId,
          assignedByUserId: input.assignedByUserId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .onConflictDoNothing()
    },

    async assignApplicationRole(input) {
      await db
        .insert(applicationRoleAssignment)
        .values({
          id: input.id,
          roleId: input.roleId,
          applicationId: input.subjectId,
          assignedByUserId: input.assignedByUserId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .onConflictDoNothing()
    },

    async assignMemberRole(input) {
      await db
        .insert(memberRoleAssignment)
        .values({
          id: input.id,
          roleId: input.roleId,
          memberId: input.subjectId,
          assignedByUserId: input.assignedByUserId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .onConflictDoNothing()
    },

    async assignAgentRole(input) {
      await db
        .insert(agentRoleAssignment)
        .values({
          id: input.id,
          roleId: input.roleId,
          agentIdentityId: input.subjectId,
          assignedByUserId: input.assignedByUserId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .onConflictDoNothing()
    },

    listUserRoleAssignments(userId, scope) {
      return listAssignments(db, userRoleAssignment, eq(userRoleAssignment.userId, userId), scope)
    },

    listApplicationRoleAssignments(applicationId, scope) {
      return listAssignments(
        db,
        applicationRoleAssignment,
        eq(applicationRoleAssignment.applicationId, applicationId),
        {
          ...scope,
          applicationId,
        },
      )
    },

    listMemberRoleAssignments(memberId, scope) {
      return listAssignments(db, memberRoleAssignment, eq(memberRoleAssignment.memberId, memberId), scope)
    },

    listAgentRoleAssignments(agentIdentityId, scope) {
      return listAssignments(db, agentRoleAssignment, eq(agentRoleAssignment.agentIdentityId, agentIdentityId), scope)
    },
  }
}

async function listAssignments(
  db: Database,
  assignmentTable:
    | typeof userRoleAssignment
    | typeof applicationRoleAssignment
    | typeof memberRoleAssignment
    | typeof agentRoleAssignment,
  subjectFilter: ReturnType<typeof eq>,
  scope: RoleAssignmentScope,
) {
  const now = new Date()
  const rows = await db
    .select({ assignment: assignmentTable, role, scope: roleScope.scope })
    .from(assignmentTable)
    .innerJoin(role, eq(assignmentTable.roleId, role.id))
    .leftJoin(roleScope, eq(role.id, roleScope.roleId))
    .where(
      and(
        subjectFilter,
        or(isNull(assignmentTable.expiresAt), gt(assignmentTable.expiresAt, now)),
        scope.resourceId ? eq(role.resourceId, scope.resourceId) : isNull(role.resourceId),
        scope.organizationId
          ? or(eq(role.organizationId, scope.organizationId), isNull(role.organizationId))
          : isNull(role.organizationId),
        scope.applicationId
          ? or(eq(role.applicationId, scope.applicationId), isNull(role.applicationId))
          : isNull(role.applicationId),
      ),
    )

  const assignments = new Map<
    string,
    {
      role: ReturnType<typeof toRole>
      scopes: string[]
    }
  >()
  for (const row of rows) {
    const current = assignments.get(row.role.id) ?? {
      role: toRole(row.role),
      scopes: [],
    }
    if (row.scope) current.scopes.push(row.scope)
    assignments.set(row.role.id, current)
  }
  return [...assignments.values()]
}

async function totalRows(
  db: Database,
  table: Parameters<ReturnType<Database['select']>['from']>[0],
  where?: ReturnType<typeof eq>,
) {
  const query = db.select({ total: count() }).from(table)
  const rows = where ? await query.where(where) : await query
  return rows[0]?.total ?? 0
}

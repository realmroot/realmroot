import { and, count, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import {
  apiPermission,
  apiResource,
  apiScope,
  applicationRoleAssignment,
  invitation,
  member,
  memberRoleAssignment,
  organization,
  role,
  rolePermission,
  userRoleAssignment,
} from '../../db/schema'
import type {
  ApiPermissionRecordInput,
  ApiScopeRecordInput,
  AuthorizationRepository,
  RoleAssignmentScope,
} from './service'

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

    async createScope(resourceId, input) {
      await db.insert(apiScope).values({ ...input, resourceId })
      return { ...input, resourceId }
    },

    async listScopes(resourceId, pagination) {
      const rows = await db
        .select()
        .from(apiScope)
        .where(eq(apiScope.resourceId, resourceId))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const total = await totalRows(db, apiScope, eq(apiScope.resourceId, resourceId))
      return { items: rows.map(toScope), pagination: toPagination(pagination, total) }
    },

    async listScopesByValues(resourceId, values) {
      if (values.length === 0) return []
      const rows = await db
        .select()
        .from(apiScope)
        .where(
          resourceId
            ? and(eq(apiScope.resourceId, resourceId), inArray(apiScope.value, values))
            : inArray(apiScope.value, values),
        )
      return rows.map(toScope)
    },

    async findScope(id) {
      const rows = await db.select().from(apiScope).where(eq(apiScope.id, id)).limit(1)
      return rows[0] ? toScope(rows[0]) : null
    },

    async updateScope(id, patch) {
      await db.update(apiScope).set(withoutUndefined(patch)).where(eq(apiScope.id, id))
    },

    async deleteScope(id) {
      await db.delete(apiScope).where(eq(apiScope.id, id))
    },

    async createPermission(resourceId, input) {
      await db.insert(apiPermission).values({ ...input, resourceId })
      return { ...input, resourceId }
    },

    async listPermissions(resourceId, pagination) {
      const rows = await db
        .select()
        .from(apiPermission)
        .where(eq(apiPermission.resourceId, resourceId))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const total = await totalRows(db, apiPermission, eq(apiPermission.resourceId, resourceId))
      return { items: rows.map(toPermission), pagination: toPagination(pagination, total) }
    },

    async findPermission(id) {
      const rows = await db.select().from(apiPermission).where(eq(apiPermission.id, id)).limit(1)
      return rows[0] ? toPermission(rows[0]) : null
    },

    async updatePermission(id, patch) {
      await db.update(apiPermission).set(withoutUndefined(patch)).where(eq(apiPermission.id, id))
    },

    async deletePermission(id) {
      await db.delete(apiPermission).where(eq(apiPermission.id, id))
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

    async listRolePermissions(roleId) {
      const rows = await db
        .select({ permission: apiPermission })
        .from(rolePermission)
        .innerJoin(apiPermission, eq(rolePermission.permissionId, apiPermission.id))
        .where(eq(rolePermission.roleId, roleId))
      return rows.map((row) => toPermission(row.permission))
    },

    async replaceRolePermissions(roleId, permissionIds) {
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db.delete(rolePermission).where(eq(rolePermission.roleId, roleId)),
      ]
      if (permissionIds.length > 0) {
        statements.push(
          db.insert(rolePermission).values(permissionIds.map((permissionId) => ({ roleId, permissionId }))),
        )
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
          tokenClaims: input.tokenClaims,
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
          tokenClaims: input.tokenClaims,
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
          tokenClaims: input.tokenClaims,
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
  }
}

async function listAssignments(
  db: Database,
  assignmentTable: typeof userRoleAssignment | typeof applicationRoleAssignment | typeof memberRoleAssignment,
  subjectFilter: ReturnType<typeof eq>,
  scope: RoleAssignmentScope,
) {
  const now = new Date()
  const rows = await db
    .select({ assignment: assignmentTable, role, permission: apiPermission })
    .from(assignmentTable)
    .innerJoin(role, eq(assignmentTable.roleId, role.id))
    .leftJoin(rolePermission, eq(role.id, rolePermission.roleId))
    .leftJoin(apiPermission, eq(rolePermission.permissionId, apiPermission.id))
    .where(
      and(
        subjectFilter,
        or(isNull(assignmentTable.expiresAt), gt(assignmentTable.expiresAt, now)),
        scope.resourceId ? or(eq(role.resourceId, scope.resourceId), isNull(role.resourceId)) : isNull(role.resourceId),
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
      permissions: ReturnType<typeof toPermission>[]
      tokenClaims: Record<string, unknown> | null
    }
  >()
  for (const row of rows) {
    const current = assignments.get(row.role.id) ?? {
      role: toRole(row.role),
      permissions: [],
      tokenClaims: row.assignment.tokenClaims,
    }
    if (row.permission) current.permissions.push(toPermission(row.permission))
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

function toOrganization(row: typeof organization.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    displayName: row.displayName,
    logo: row.logo,
    disabled: row.disabled,
    disabledReason: row.disabledReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toMember(row: typeof member.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toInvitation(row: typeof invitation.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    inviterId: row.inviterId,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function toResource(row: typeof apiResource.$inferSelect) {
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    audience: row.audience,
    description: row.description,
    enabled: row.enabled,
    tokenClaimsNamespace: row.tokenClaimsNamespace,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toScope(row: typeof apiScope.$inferSelect): ApiScopeRecordInput {
  return {
    id: row.id,
    resourceId: row.resourceId,
    value: row.value,
    description: row.description,
    required: row.required,
    tokenClaimName: row.tokenClaimName,
    includeInAccessToken: row.includeInAccessToken,
    includeInIdToken: row.includeInIdToken,
  }
}

function toPermission(row: typeof apiPermission.$inferSelect): ApiPermissionRecordInput {
  return {
    id: row.id,
    resourceId: row.resourceId,
    scopeId: row.scopeId,
    key: row.key,
    description: row.description,
    tokenClaimValue: row.tokenClaimValue,
  }
}

function toRole(row: typeof role.$inferSelect) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    resourceId: row.resourceId,
    organizationId: row.organizationId,
    applicationId: row.applicationId,
    system: row.system,
    tokenClaimName: row.tokenClaimName,
    tokenClaimValue: row.tokenClaimValue,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toPagination(pagination: { limit: number; offset: number }, total: number) {
  const nextOffset = pagination.offset + pagination.limit < total ? pagination.offset + pagination.limit : null

  return {
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    hasMore: nextOffset !== null,
    nextOffset,
  }
}

function withoutUndefined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

import type { Database } from '@server/db/client'
import { applicationSession, applicationSessionToken, oauthRefreshToken } from '@server/db/schema'
import type { IdentifierGenerator } from '@server/usecases/identifier-generator'
import type { ApplicationSessionRepository } from '@server/usecases/ports'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

export interface RefreshAuthorizationInput {
  token: string
  clientId: string
  userId: string
  sessionId?: string | null
  referenceId?: string | null
  authTime?: Date | null
  scopes: string[]
  resources?: string[]
  createdAt: Date
  expiresAt: Date
}

export function createApplicationSessionRepository(db: Database): ApplicationSessionRepository {
  return {
    async list(userId, clientId, page) {
      const now = Date.now()
      const active = and(
        eq(applicationSession.userId, userId),
        eq(applicationSession.clientId, clientId),
        isNull(applicationSession.revokedAt),
        sql`exists (select 1 from application_session_token l join oauth_refresh_token t on t.id = l.token_id
          where l.application_session_id = ${applicationSession.id} and t.revoked is null and t.expires_at > ${now})`,
      )
      const [items, totals] = await db.batch([
        db
          .select()
          .from(applicationSession)
          .where(active)
          .orderBy(desc(applicationSession.createdAt), desc(applicationSession.id))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ total: sql<number>`count(*)` }).from(applicationSession).where(active),
      ])
      return {
        ...page,
        total: totals[0]!.total,
        items: items.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          lastActiveAt: row.lastActiveAt.toISOString(),
          userAgent: row.userAgent,
          legacy: row.legacy,
        })),
      }
    },
    async revoke(userId, clientId, sessionId) {
      const now = new Date()
      const [revoked] = await db.batch([
        db
          .update(applicationSession)
          .set({ revokedAt: sql`coalesce(${applicationSession.revokedAt}, ${now.getTime()})` })
          .where(
            and(
              eq(applicationSession.id, sessionId),
              eq(applicationSession.userId, userId),
              eq(applicationSession.clientId, clientId),
            ),
          )
          .returning({ id: applicationSession.id }),
        db
          .update(oauthRefreshToken)
          .set({ revoked: now })
          .where(
            and(
              eq(oauthRefreshToken.userId, userId),
              eq(oauthRefreshToken.clientId, clientId),
              isNull(oauthRefreshToken.revoked),
              sql`${oauthRefreshToken.id} in (select token_id from application_session_token where application_session_id = ${sessionId})`,
            ),
          ),
      ])
      return revoked.length > 0
    },
  }
}

/** The provider delegates persistence so token consumption and lifecycle checks commit together. */
export function createRefreshAuthorizationPersistence(db: Database, ids: IdentifierGenerator) {
  const sessions = createApplicationSessionRepository(db)
  return {
    async persist(
      input: RefreshAuthorizationInput,
      originalTokenId?: string,
      userAgent?: string | null,
    ): Promise<string | null> {
      const id = ids.generate()
      const token = {
        ...input,
        id,
        sessionId: input.sessionId ?? null,
        referenceId: input.referenceId ?? null,
        authTime: input.authTime ?? null,
        scopes: JSON.stringify(input.scopes),
        resources: input.resources ? JSON.stringify(input.resources) : null,
      }
      if (!originalTokenId) {
        await db.batch([
          db.insert(applicationSession).values({
            id,
            userId: input.userId,
            clientId: input.clientId,
            createdAt: input.createdAt,
            lastActiveAt: input.createdAt,
            userAgent: userAgent?.slice(0, 512) || null,
          }),
          db.insert(oauthRefreshToken).values(token),
          db.insert(applicationSessionToken).values({ tokenId: id, applicationSessionId: id }),
        ])
        return id
      }
      const now = Date.now()
      // INSERT ... SELECT is the compare-and-swap. D1 batch serializes all four
      // statements with revocation and other rotations, including across Workers.
      const insertedExists = sql`exists (select 1 from oauth_refresh_token where id = ${id})`
      const [inserted] = await db.batch([
        db
          .insert(oauthRefreshToken)
          .select(
            db
              .select({
                id: sql<string>`${id}`.as('id'),
                token: sql<string>`${token.token}`.as('token'),
                clientId: sql<string>`${token.clientId}`.as('client_id'),
                sessionId: sql<string | null>`${token.sessionId}`.as('session_id'),
                userId: sql<string>`${token.userId}`.as('user_id'),
                referenceId: sql<string | null>`${token.referenceId}`.as('reference_id'),
                expiresAt: sql<Date>`${token.expiresAt.getTime()}`.as('expires_at'),
                createdAt: sql<Date>`${token.createdAt.getTime()}`.as('created_at'),
                revoked: sql<Date | null>`${null}`.as('revoked'),
                authTime: sql<Date | null>`${token.authTime?.getTime() ?? null}`.as('auth_time'),
                scopes: sql<string>`${token.scopes}`.as('scopes'),
                resources: sql<string | null>`${token.resources}`.as('resources'),
              })
              .from(oauthRefreshToken)
              .innerJoin(applicationSessionToken, eq(applicationSessionToken.tokenId, oauthRefreshToken.id))
              .innerJoin(applicationSession, eq(applicationSession.id, applicationSessionToken.applicationSessionId))
              .where(
                and(
                  eq(oauthRefreshToken.id, originalTokenId),
                  isNull(oauthRefreshToken.revoked),
                  sql`${oauthRefreshToken.expiresAt} > ${now}`,
                  isNull(applicationSession.revokedAt),
                  eq(applicationSession.userId, token.userId),
                  eq(applicationSession.clientId, token.clientId),
                ),
              ),
          )
          .returning({ id: oauthRefreshToken.id }),
        db
          .update(oauthRefreshToken)
          .set({ revoked: new Date(now) })
          .where(and(eq(oauthRefreshToken.id, originalTokenId), insertedExists)),
        db.insert(applicationSessionToken).select(
          db
            .select({
              tokenId: sql<string>`${id}`.as('token_id'),
              applicationSessionId: applicationSessionToken.applicationSessionId,
            })
            .from(applicationSessionToken)
            .where(and(eq(applicationSessionToken.tokenId, originalTokenId), insertedExists)),
        ),
        db
          .update(applicationSession)
          .set({ lastActiveAt: new Date(now) })
          .where(
            sql`${applicationSession.id} in (select application_session_id from application_session_token where token_id = ${id})`,
          ),
      ])
      return inserted.length ? id : null
    },
    async revoke(tokenId: string) {
      const [linked] = await db
        .select({ session: applicationSession })
        .from(applicationSessionToken)
        .innerJoin(applicationSession, eq(applicationSession.id, applicationSessionToken.applicationSessionId))
        .where(eq(applicationSessionToken.tokenId, tokenId))
      if (linked) await sessions.revoke(linked.session.userId, linked.session.clientId, linked.session.id)
    },
  }
}

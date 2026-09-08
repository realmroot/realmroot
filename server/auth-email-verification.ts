import { and, eq, isNull } from 'drizzle-orm'
import { jwtVerify, SignJWT } from 'jose'
import type { Database } from './db/client'
import { user } from './db/schema'

// Email addresses can be reused. Bind signed links to the immutable account id
// so an old link cannot act on a new account, even if created in the same second.
export async function bindEmailVerification(userId: string, token: string, secret: string) {
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
  return new SignJWT({ ...payload, sub: userId }).setProtectedHeader({ alg: 'HS256' }).sign(key)
}

export async function hasLiveEmailVerification(db: Database, token: string, secret: string) {
  let claims: { sub?: string; email?: unknown }
  try {
    claims = (await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] })).payload
  } catch {
    return false
  }
  if (typeof claims.email !== 'string' || !claims.sub) return false
  const [record] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, claims.sub), eq(user.email, claims.email), isNull(user.deletedAt)))
  return Boolean(record)
}

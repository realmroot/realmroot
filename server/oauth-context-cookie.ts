import { parseSigned, serializeSigned } from 'hono/utils/cookie'

/**
 * The authorization Context this browser last picked for each OAuth client, kept on Realmroot's own
 * origin so `prompt=none` can pick among several qualifying Contexts. It is only a hint: silent
 * authorization still requires current membership and a covering consent in the named Context.
 */
export const oauthContextCookieName = 'realmroot.oauth_context'
export const oauthContextCookiePath = '/api/auth/oauth2'
export const oauthContextCookieMaxClients = 20
const maxAgeSeconds = 400 * 24 * 60 * 60

type RememberedContexts = Array<[clientId: string, contextId: string]>

/** Most recent first. A missing, unsigned, forged, or malformed cookie reads as empty. */
export async function readRememberedOAuthContexts(
  cookieHeader: string | null,
  secret: string,
): Promise<RememberedContexts> {
  if (!cookieHeader) return []
  const value = (await parseSigned(cookieHeader, secret, oauthContextCookieName))[oauthContextCookieName]
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (entry): entry is [string, string] =>
      Array.isArray(entry) && entry.length === 2 && entry.every((part) => typeof part === 'string' && part.length > 0),
  )
}

export async function rememberedOAuthContext(cookieHeader: string | null, secret: string, clientId: string) {
  const entries = await readRememberedOAuthContexts(cookieHeader, secret)
  return entries.find(([entryClientId]) => entryClientId === clientId)?.[1] ?? null
}

/** A `Set-Cookie` value that records `contextId` as this browser's latest pick for `clientId`. */
export async function rememberOAuthContextCookie(
  cookieHeader: string | null,
  secret: string,
  clientId: string,
  contextId: string,
) {
  const entries = await readRememberedOAuthContexts(cookieHeader, secret)
  const latest: [string, string] = [clientId, contextId]
  const next = [latest, ...entries.filter(([entryClientId]) => entryClientId !== clientId)].slice(
    0,
    oauthContextCookieMaxClients,
  )
  return serializeSigned(oauthContextCookieName, JSON.stringify(next), secret, {
    path: oauthContextCookiePath,
    maxAge: maxAgeSeconds,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  })
}

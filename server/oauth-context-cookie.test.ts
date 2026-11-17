import { serializeSigned } from 'hono/utils/cookie'
import { describe, expect, it } from 'vitest'
import {
  oauthContextCookieMaxClients,
  oauthContextCookieName,
  readRememberedOAuthContexts,
  rememberedOAuthContext,
  rememberOAuthContextCookie,
} from './oauth-context-cookie'

const secret = 'unit-secret-with-enough-entropy-for-hmac'
const cookiePair = (setCookie: string) => setCookie.split(';')[0]!
const signedValue = async (value: string, key = secret) =>
  cookiePair(await serializeSigned(oauthContextCookieName, value, key))

describe('[spec: hosted-auth/oauth-silent-authorization-context] remembered OAuth Context cookie', () => {
  it('records the latest pick per client, most recent first, with hardened attributes', async () => {
    const first = await rememberOAuthContextCookie(null, secret, 'client-a', 'organization:a')
    expect(first).toMatch(
      /^realmroot\.oauth_context=[^;]+; Max-Age=34560000; Path=\/api\/auth\/oauth2; HttpOnly; Secure; SameSite=Lax$/,
    )
    const second = cookiePair(
      await rememberOAuthContextCookie(`other=1; ${cookiePair(first)}`, secret, 'client-b', 'user:u1'),
    )
    const third = cookiePair(await rememberOAuthContextCookie(second, secret, 'client-a', 'organization:b'))
    await expect(readRememberedOAuthContexts(third, secret)).resolves.toEqual([
      ['client-a', 'organization:b'],
      ['client-b', 'user:u1'],
    ])
    await expect(rememberedOAuthContext(third, secret, 'client-b')).resolves.toBe('user:u1')
    await expect(rememberedOAuthContext(third, secret, 'client-c')).resolves.toBeNull()
  })

  it(`keeps only the ${oauthContextCookieMaxClients} most recent clients`, async () => {
    let cookie: string | null = null
    for (let index = 0; index <= oauthContextCookieMaxClients; index++) {
      cookie = cookiePair(await rememberOAuthContextCookie(cookie, secret, `client-${index}`, `user:${index}`))
    }
    const entries = await readRememberedOAuthContexts(cookie, secret)
    expect(entries).toHaveLength(oauthContextCookieMaxClients)
    expect(entries[0]).toEqual([`client-${oauthContextCookieMaxClients}`, `user:${oauthContextCookieMaxClients}`])
    expect(entries.some(([clientId]) => clientId === 'client-0')).toBe(false)
  })

  it('reads a missing, forged, unsigned or malformed cookie as nothing remembered', async () => {
    const entries = JSON.stringify([['client-a', 'organization:a']])
    for (const cookie of [
      null,
      '',
      'other=1',
      await signedValue(entries, 'another-secret'),
      `${oauthContextCookieName}=${encodeURIComponent(entries)}`,
      (await signedValue(entries)).replace('organization%3Aa', 'organization%3Ab'),
      await signedValue('not json'),
      await signedValue(JSON.stringify({ 'client-a': 'organization:a' })),
    ]) {
      await expect(readRememberedOAuthContexts(cookie, secret)).resolves.toEqual([])
    }
  })

  it('drops malformed entries and keeps the well-formed ones', async () => {
    const cookie = await signedValue(
      JSON.stringify([['client-a', 'organization:a'], ['client-b'], ['client-c', ''], ['client-d', 4], 'client-e']),
    )
    await expect(readRememberedOAuthContexts(cookie, secret)).resolves.toEqual([['client-a', 'organization:a']])
  })
})

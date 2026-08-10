import { authenticateProviderConnectionEvent } from '@server/http/provider-connection-event-auth'
// biome-ignore lint/style/useNodejsImportProtocol: Match the Worker module specifier exercised by this test.
import { timingSafeEqual } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('crypto')>()
  return { ...original, timingSafeEqual: vi.fn(original.timingSafeEqual) }
})

const secret = 'provider-connection-event-secret-for-tests-2026'
const url = 'https://auth.example.com/api/resource-servers/event-resource/connection-events/delivery-1'
const path = '/api/resource-servers/event-resource/connection-events/delivery-1'
const body = new TextEncoder().encode('{"type":"authorityChanged"}')
const now = new Date('2026-08-08T20:00:00.000Z')
const timestamp = `${Math.floor(now.getTime() / 1000)}`
beforeEach(() => {
  vi.mocked(timingSafeEqual).mockClear()
})

describe('Provider Connection Event authentication', () => {
  it('hashes Bearer values before fixed-length timing-safe comparison', async () => {
    const request = await signedRequest()
    request.headers.set('Authorization', 'Bearer wrong')
    await expect(authenticateProviderConnectionEvent(request, body, secret, now)).rejects.toThrow(
      'Connection Event credentials are invalid.',
    )
    expect(comparisonLengths()).toEqual([[32, 32]])
  })

  it.each([
    ['wrong length', `sha256=${'a'.repeat(62)}`],
    ['non-hex', `sha256=${'g'.repeat(64)}`],
  ])('rejects a %s signature before byte comparison', async (_name, signature) => {
    const request = await signedRequest()
    request.headers.set('Realmroot-Signature', signature)
    await expect(authenticateProviderConnectionEvent(request, body, secret, now)).rejects.toThrow(
      'Connection Event signature is invalid.',
    )
    expect(comparisonLengths()).toEqual([[32, 32]])
  })

  it('rejects wrong signature bytes after fixed-length timing-safe comparison', async () => {
    const request = await signedRequest()
    request.headers.set('Realmroot-Signature', `sha256=${'0'.repeat(64)}`)
    await expect(authenticateProviderConnectionEvent(request, body, secret, now)).rejects.toThrow(
      'Connection Event signature is invalid.',
    )
    expect(comparisonLengths()).toEqual([
      [32, 32],
      [32, 32],
    ])
  })
})

async function signedRequest() {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const prefix = new TextEncoder().encode(`${timestamp}\nPUT\n${path}\n`)
  const signedContent = new Uint8Array(prefix.length + body.length)
  signedContent.set(prefix)
  signedContent.set(body, prefix.length)
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signedContent))
  const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return new Request(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Realmroot-Timestamp': timestamp,
      'Realmroot-Signature': `sha256=${hex}`,
    },
  })
}

function comparisonLengths() {
  return vi.mocked(timingSafeEqual).mock.calls.map(([left, right]) => [left.byteLength, right.byteLength])
}

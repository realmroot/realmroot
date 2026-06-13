import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asRecord,
  base64UrlToBuffer,
  bufferToBase64Url,
  enrollPasskey,
  enrollWallet,
  formatDate,
  formatSessionDevice,
  readChainId,
  readFirstString,
  readRedirectUrl,
  readRequiredString,
  readString,
  readStringArray,
  readTotpEnrollment,
} from './utils'

const base = 'http://localhost:3000'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

describe('pure readers', () => {
  it('round-trips base64url buffers', () => {
    expect(bufferToBase64Url(new Uint8Array([251, 255]).buffer)).toBe('-_8')
    expect(Array.from(new Uint8Array(base64UrlToBuffer('-_8')))).toEqual([251, 255])
  })

  it('normalizes records, strings, and arrays', () => {
    expect(asRecord({ id: 'value' })).toEqual({ id: 'value' })
    expect(asRecord(null)).toEqual({})
    expect(asRecord('string')).toEqual({})
    expect(readString('value')).toBe('value')
    expect(readString('')).toBeNull()
    expect(readString(5)).toBeNull()
    expect(readFirstString(['first'])).toBe('first')
    expect(readFirstString([1])).toBeNull()
    expect(readFirstString('not-array')).toBeNull()
    expect(readStringArray(['a', '', 'b', 2])).toEqual(['a', 'b'])
    expect(readStringArray('nope')).toEqual([])
  })

  it('parses chain ids and required strings', () => {
    expect(readChainId(1)).toBe(1)
    expect(readChainId('0x2105')).toBe(8453)
    expect(readChainId('10')).toBe(10)
    expect(() => readChainId(null)).toThrow('Wallet did not return a chain ID.')
    expect(readRequiredString('challenge', 'challenge')).toBe('challenge')
    expect(() => readRequiredString('', 'challenge')).toThrow('Passkey registration option challenge is required.')
    expect(() => readRequiredString(5, 'challenge')).toThrow('Passkey registration option challenge is required.')
  })

  it('reads redirect urls from varied response shapes', () => {
    expect(readRedirectUrl({ url: '/profile' })).toBe('/profile')
    expect(readRedirectUrl({ redirectTo: '/settings' })).toBe('/settings')
    expect(readRedirectUrl({ callbackURL: '/callback' })).toBe('/callback')
    expect(readRedirectUrl({ url: 1 })).toBeNull()
    expect(readRedirectUrl(null)).toBeNull()
    expect(readRedirectUrl('string')).toBeNull()
    expect(readRedirectUrl({})).toBeNull()
  })

  it('formats session devices and dates', () => {
    expect(formatSessionDevice(null)).toBe('Unknown device')
    expect(formatSessionDevice('Custom Agent')).toBe('Custom Agent')
    expect(formatSessionDevice('Mozilla/5.0 (Mac OS X) Chrome/120')).toBe('Chrome on macOS')
    expect(formatSessionDevice('Mozilla/5.0 (Windows) Edg/120')).toBe('Edge on Windows')
    expect(formatSessionDevice('Mozilla/5.0 (Android) Firefox/120')).toBe('Firefox on Android')
    expect(formatSessionDevice('Mozilla/5.0 (iPhone) Safari/16')).toBe('Safari on iOS')
    expect(formatSessionDevice('Mozilla/5.0 (iPad) Safari/16')).toBe('Safari on iOS')
    expect(formatSessionDevice('SomethingElse/1.0')).toBe('Browser session')
    expect(typeof formatDate('2026-01-01T00:00:00.000Z')).toBe('string')
    expect(typeof formatDate(new Date('2026-01-01'))).toBe('string')
  })

  it('reads totp enrollment fields with fallbacks', () => {
    expect(readTotpEnrollment({ qrCode: 'qr', otpAuthUri: 'uri', secret: 's', backupCodes: ['a'] })).toEqual({
      qrCode: 'qr',
      otpAuthUri: 'uri',
      secret: 's',
      backupCodes: ['a'],
    })
    expect(readTotpEnrollment({ qr: 'qr2', totpURI: 'uri2' })).toEqual({
      qrCode: 'qr2',
      otpAuthUri: 'uri2',
      secret: null,
      backupCodes: [],
    })
    expect(readTotpEnrollment(null)).toEqual({ qrCode: null, otpAuthUri: null, secret: null, backupCodes: [] })
  })
})

describe('enrollPasskey', () => {
  const optionChallenge = bufferToBase64Url(new Uint8Array([1, 2, 3]).buffer)
  const userId = bufferToBase64Url(new Uint8Array([4, 5, 6]).buffer)
  const excludeId = bufferToBase64Url(new Uint8Array([7, 8, 9]).buffer)

  beforeEach(() => {
    server.use(
      http.get(`${base}/api/auth/passkey/generate-register-options`, () =>
        HttpResponse.json({
          publicKey: {
            challenge: optionChallenge,
            user: { id: userId, name: 'jane', displayName: 'Jane Stone' },
            excludeCredentials: [{ id: excludeId, type: 'public-key' }],
          },
        }),
      ),
      http.post(`${base}/api/auth/passkey/verify-registration`, async ({ request }) =>
        HttpResponse.json({ verified: true, received: await request.json() }),
      ),
    )
  })

  it('serializes the created credential and posts verification', async () => {
    const createdCredential = {
      id: 'cred-1',
      type: 'public-key',
      rawId: new Uint8Array([10, 11]).buffer,
      response: {
        attestationObject: new Uint8Array([12, 13]).buffer,
        clientDataJSON: new Uint8Array([14, 15]).buffer,
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
    }
    const create = vi.fn().mockResolvedValue(createdCredential)
    vi.stubGlobal('navigator', { credentials: { create } })

    const result = (await enrollPasskey('My Key')) as { verified: boolean; received: Record<string, unknown> }

    expect(result.verified).toBe(true)
    expect(create).toHaveBeenCalledOnce()
    const passed = create.mock.calls[0][0].publicKey
    expect(Array.from(new Uint8Array(passed.challenge))).toEqual([1, 2, 3])
    expect(passed.user.name).toBe('jane')
    expect(Array.from(new Uint8Array(passed.excludeCredentials[0].id))).toEqual([7, 8, 9])
    const sent = result.received as { name: string; response: { id: string } }
    expect(sent.name).toBe('My Key')
    expect((sent.response as unknown as { rawId: string }).rawId).toBe(bufferToBase64Url(createdCredential.rawId))
  })

  it('handles credentials without optional getters and empty name', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'cred-2',
      type: 'public-key',
      rawId: new Uint8Array([1]).buffer,
      response: {
        attestationObject: new Uint8Array([2]).buffer,
        clientDataJSON: new Uint8Array([3]).buffer,
      },
    })
    vi.stubGlobal('navigator', { credentials: { create } })

    const result = (await enrollPasskey('')) as { verified: boolean }
    expect(result.verified).toBe(true)
  })

  it('throws when credentials.create is unavailable', async () => {
    vi.stubGlobal('navigator', { credentials: {} })
    await expect(enrollPasskey('x')).rejects.toThrow('Passkey registration is not supported by this browser.')
  })

  it('throws when credential creation is cancelled', async () => {
    vi.stubGlobal('navigator', { credentials: { create: vi.fn().mockResolvedValue(null) } })
    await expect(enrollPasskey('x')).rejects.toThrow('Passkey registration was cancelled.')
  })
})

describe('enrollWallet', () => {
  function stubEthereum(handlers: Record<string, unknown>) {
    const request = vi.fn(async ({ method }: { method: string; params?: unknown }) => {
      const value = handlers[method]
      if (typeof value === 'function') return (value as () => unknown)()
      return value
    })
    vi.stubGlobal('window', Object.assign(window, { ethereum: { request } }))
    return request
  }

  it('signs a SIWE message and links the wallet', async () => {
    let linked: unknown = null
    server.use(
      http.post(`${base}/api/auth/siwe/nonce`, () => HttpResponse.json({ nonce: 'nonce12345' })),
      http.post(`${base}/api/account/wallet-addresses`, async ({ request }) => {
        linked = await request.json()
        return HttpResponse.json({ id: 'wallet-1' })
      }),
    )
    stubEthereum({
      eth_requestAccounts: ['0x1111111111111111111111111111111111111111'],
      eth_chainId: '0x1',
      personal_sign: '0xsignature',
    })

    const result = (await enrollWallet([1])) as { id: string }
    expect(result.id).toBe('wallet-1')
    expect((linked as { walletAddress: string }).walletAddress).toBe('0x1111111111111111111111111111111111111111')
    expect((linked as { signature: string }).signature).toBe('0xsignature')
  })

  it('throws when no wallet provider exists', async () => {
    vi.stubGlobal('window', Object.assign(window, { ethereum: undefined }))
    await expect(enrollWallet([1])).rejects.toThrow('No wallet provider was found in this browser.')
  })

  it('throws when no account is selected', async () => {
    stubEthereum({ eth_requestAccounts: [] })
    await expect(enrollWallet([1])).rejects.toThrow('No wallet account was selected.')
  })

  it('throws when the wallet network is not enabled', async () => {
    stubEthereum({
      eth_requestAccounts: ['0x1111111111111111111111111111111111111111'],
      eth_chainId: '0xa',
    })
    await expect(enrollWallet([1])).rejects.toThrow('This wallet network is not enabled. Switch to chain 1.')
  })

  it('throws when the wallet returns no signature', async () => {
    server.use(http.post(`${base}/api/auth/siwe/nonce`, () => HttpResponse.json({ nonce: 'nonce12345' })))
    stubEthereum({
      eth_requestAccounts: ['0x1111111111111111111111111111111111111111'],
      eth_chainId: '0x1',
      personal_sign: '',
    })
    await expect(enrollWallet([1])).rejects.toThrow('Wallet did not return a signature.')
  })
})

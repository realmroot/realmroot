import { createSecretCipher } from '@server/adapters/gateways/secrets'
import { describe, expect, it } from 'vitest'

describe('secret cipher', () => {
  it('encrypts with randomized authenticated envelopes and requires the original context', async () => {
    const cipher = createSecretCipher('credential-encryption-master-key-for-tests')
    const first = await cipher.seal('client-secret', 'connector:one:client-secret')
    const second = await cipher.seal('client-secret', 'connector:one:client-secret')

    expect(first).toMatch(/^v1\./)
    expect(first).not.toBe(second)
    expect(first).not.toContain('client-secret')
    await expect(cipher.open(first, 'connector:one:client-secret')).resolves.toBe('client-secret')
    await expect(cipher.open(first, 'connector:two:client-secret')).rejects.toThrow()
  })

  it('fails fast when the master secret is too short', () => {
    expect(() => createSecretCipher('short')).toThrow('CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.')
  })

  it('rejects malformed envelope components before decryption', async () => {
    const cipher = createSecretCipher('credential-encryption-master-key-for-tests')
    for (const envelope of ['v2.iv.ciphertext', 'v1..ciphertext', 'v1.iv.', 'v1.iv.ciphertext.extra']) {
      await expect(cipher.open(envelope, 'context')).rejects.toThrow('Encrypted secret envelope is invalid.')
    }
  })
})

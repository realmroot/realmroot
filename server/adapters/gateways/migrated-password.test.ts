import { verifyStoredPassword } from '@server/adapters/gateways/migrated-password'
import { hashPassword } from '@server/domain/password'
import { describe, expect, it } from 'vitest'

const legacyHash =
  'better-auth-scrypt-v1:07070707070707070707070707070707:1a3af5c34b3e4fe929b025a6a1b7b7c733d796dc5792289a93435366491677884714d137ca0deaa394d519c676539af8096a6122a73251117b9b0642fe6a8366'

describe('migrated password verification', () => {
  it('[spec: hosted-auth/better-auth-password-migration] verifies a directly imported Better Auth scrypt hash', async () => {
    await expect(verifyStoredPassword(legacyHash, 'legacy-password')).resolves.toBe(true)
    await expect(verifyStoredPassword(legacyHash, 'incorrect')).resolves.toBe(false)
  })

  it('[spec: hosted-auth/better-auth-password-migration] preserves every password when credentials are merged', async () => {
    const primaryHash = await hashPassword('realmroot-password')
    const mergedHash = await hashPassword('second-realmroot-password')
    const bundle = `realmroot-password-bundle-v1:${encode(primaryHash)}:${encode(mergedHash)}:${encode(legacyHash)}`

    await expect(verifyStoredPassword(bundle, 'realmroot-password')).resolves.toBe(true)
    await expect(verifyStoredPassword(bundle, 'second-realmroot-password')).resolves.toBe(true)
    await expect(verifyStoredPassword(bundle, 'legacy-password')).resolves.toBe(true)
    await expect(verifyStoredPassword(bundle, 'incorrect')).resolves.toBe(false)
  })

  it('rejects malformed Better Auth hashes and password bundles', async () => {
    await expect(verifyStoredPassword('better-auth-scrypt-v1:short:bad', 'password')).rejects.toThrow(
      'Invalid Better Auth password hash',
    )
    await expect(verifyStoredPassword('realmroot-password-bundle-v1:broken', 'password')).rejects.toThrow(
      'Invalid password bundle',
    )
  })
})

function encode(value: string): string {
  return Buffer.from(value).toString('base64url')
}

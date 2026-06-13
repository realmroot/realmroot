import { hashPassword, verifyPassword } from '@server/domain/password'
import { describe, expect, it } from 'vitest'

describe('password hashing', () => {
  it('verifies the original password', async () => {
    const hash = await hashPassword('correct horse battery staple')

    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true)
    await expect(verifyPassword(hash, 'incorrect')).resolves.toBe(false)
  })

  it('verifies existing hashes that carry a previous iteration count', async () => {
    const hash = 'pbkdf2-sha256:210000:BwcHBwcHBwcHBwcHBwcHBw:97KcwAJxSwC4Xbe9ZkIZFlRDAW7fQpwhpH7uhPFuQx0'

    await expect(verifyPassword(hash, 'legacy-password')).resolves.toBe(true)
  })

  it('rejects hashes that use an unsupported storage format', async () => {
    const hash = 'bcrypt:210000:BwcHBwcHBwcHBwcHBwcHBw:97KcwAJxSwC4Xbe9ZkIZFlRDAW7fQpwhpH7uhPFuQx0'

    await expect(verifyPassword(hash, 'legacy-password')).rejects.toThrow('Unsupported password hash format: bcrypt')
  })

  it('rejects hashes with non-integer or out-of-range iteration counts', async () => {
    const nonInteger = 'pbkdf2-sha256:abc:BwcHBwcHBwcHBwcHBwcHBw:97KcwAJxSwC4Xbe9ZkIZFlRDAW7fQpwhpH7uhPFuQx0'
    const tooMany = 'pbkdf2-sha256:9999999:BwcHBwcHBwcHBwcHBwcHBw:97KcwAJxSwC4Xbe9ZkIZFlRDAW7fQpwhpH7uhPFuQx0'

    await expect(verifyPassword(nonInteger, 'legacy-password')).rejects.toThrow(
      'Unsupported password hash iterations: abc',
    )
    await expect(verifyPassword(tooMany, 'legacy-password')).rejects.toThrow(
      'Unsupported password hash iterations: 9999999',
    )
  })

  it('returns false when the stored key length does not match the derived key', async () => {
    const truncatedKey = 'pbkdf2-sha256:210000:BwcHBwcHBwcHBwcHBwcHBw:97KcwAJxSwC4Xbe9ZkIZFl'

    await expect(verifyPassword(truncatedKey, 'legacy-password')).resolves.toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

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
})

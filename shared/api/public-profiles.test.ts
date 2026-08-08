import { describe, expect, it } from 'vitest'
import { accountProfileLinkSchema, publicProfileLinkSchema } from './public-profiles'

describe('public profile links', () => {
  it('accepts HTTPS links and rejects active or insecure URL schemes', () => {
    expect(publicProfileLinkSchema.parse({ type: 'website', label: 'Website', url: 'https://example.com' })).toEqual({
      type: 'website',
      label: 'Website',
      url: 'https://example.com',
    })

    for (const url of ['http://example.com', 'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com']) {
      expect(() => publicProfileLinkSchema.parse({ type: 'website', label: 'Unsafe', url })).toThrow()
    }
  })

  it('requires an internal account reference only for linked-account settings', () => {
    expect(
      accountProfileLinkSchema.parse({
        type: 'linked-account',
        accountId: 'account-1',
        providerId: 'github',
        label: 'GitHub',
        url: 'https://github.com/example',
      }),
    ).toMatchObject({ accountId: 'account-1', providerId: 'github' })
    expect(() =>
      accountProfileLinkSchema.parse({
        type: 'linked-account',
        providerId: 'github',
        label: 'GitHub',
        url: 'https://github.com/example',
      }),
    ).toThrow()
  })
})

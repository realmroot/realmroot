import { describe, expect, it } from 'vitest'
import { externalServiceLinkSchema, siteNavigationResponseSchema, siteNavigationSchema } from './navigation'

const wallet = { id: 'wallet', label: 'Wallet', url: 'https://wallet.example.com', icon: 'wallet' }
describe('site navigation contract', () => {
  it('accepts an ordered list and defaults the optional icon', () => {
    expect(
      siteNavigationSchema
        .parse({ externalLinks: [wallet, { id: 'docs', label: 'Docs', url: 'https://docs.example.com' }] })
        .externalLinks.map((link) => link.icon),
    ).toEqual(['wallet', 'link'])
    expect(siteNavigationSchema.parse({ externalLinks: [] })).toEqual({ externalLinks: [] })
    expect(siteNavigationResponseSchema.parse({ externalLinks: [], revision: 0 }).revision).toBe(0)
  })
  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'https://user@example.com',
    'https://:password@example.com',
    'not a url',
  ])('rejects unsafe destination %s', (url) => {
    expect(externalServiceLinkSchema.safeParse({ ...wallet, url }).success).toBe(false)
  })
  it('rejects duplicate identifiers, excessive links and invalid revisions', () => {
    expect(siteNavigationSchema.safeParse({ externalLinks: [wallet, wallet] }).success).toBe(false)
    expect(
      siteNavigationSchema.safeParse({
        externalLinks: Array.from({ length: 21 }, (_, index) => ({ ...wallet, id: `link-${index}` })),
      }).success,
    ).toBe(false)
    expect(siteNavigationResponseSchema.safeParse({ externalLinks: [], revision: -1 }).success).toBe(false)
  })
})

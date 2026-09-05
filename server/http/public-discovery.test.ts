import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public service discovery', () => {
  it('publishes static discovery files [spec: management-api/public-service-discovery]', () => {
    expect(readFileSync('public/_headers', 'utf8')).toContain(
      '/\n  Link: </.well-known/api-catalog>; rel="api-catalog"',
    )
    const catalog = JSON.parse(readFileSync('public/.well-known/api-catalog', 'utf8'))
    expect(catalog.linkset[0].anchor).toBe('https://id.realmroot.dev/api')
    expect(catalog.linkset[0]['service-desc'][0].href).toBe('https://id.realmroot.dev/api/openapi.json')
    expect(readFileSync('public/robots.txt', 'utf8')).toContain('Sitemap: https://id.realmroot.dev/sitemap.xml')
    expect(readFileSync('public/sitemap.xml', 'utf8').match(/<loc>/g)).toHaveLength(2)
    expect(readFileSync('public/llms.txt', 'utf8')).toContain('[OpenAPI contract](/api/openapi.json)')
    expect(readFileSync('public/_redirects', 'utf8').trim().split('\n')).toEqual([
      '/.well-known/oauth-authorization-server /.well-known/oauth-authorization-server/api/auth 308',
      '/.well-known/openid-configuration /api/auth/.well-known/openid-configuration 308',
      '/.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/api 308',
      '/openapi.json /api/openapi.json 308',
    ])
  })
})

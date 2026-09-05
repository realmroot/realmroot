import { describe, expect, it, vi } from 'vitest'
import { publicDiscovery } from './public-discovery'

function fixture() {
  const fetch = vi.fn(
    async () =>
      new Response('<html>Realmroot</html>', {
        headers: { 'Content-Type': 'text/html', Vary: 'Accept-Encoding', ETag: '"html"' },
      }),
  )
  const env = { ASSETS: { fetch }, BETTER_AUTH_URL: 'https://auth.example.com' }
  return { fetch, request: (path: string, init?: RequestInit) => publicDiscovery.request(path, init, env) }
}

describe('public service discovery', () => {
  it('publishes canonical discovery without authentication [spec: management-api/public-service-discovery]', async () => {
    const { request, fetch } = fixture()
    for (const [source, target] of [
      ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/api/auth'],
      ['/.well-known/openid-configuration', '/api/auth/.well-known/openid-configuration'],
      ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api'],
      ['/openapi.json', '/api/openapi.json'],
    ]) {
      const response = await request(`${source}?ignored=1`)
      expect(response.status).toBe(308)
      expect(response.headers.get('Location')).toBe(target)
    }
    const catalog = await request('/.well-known/api-catalog')
    expect(catalog.headers.get('Content-Type')).toContain('application/linkset+json')
    expect(catalog.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await catalog.json()).toEqual({
      linkset: [
        {
          anchor: 'https://auth.example.com/api',
          'service-desc': [{ href: 'https://auth.example.com/api/openapi.json', type: 'application/json' }],
          'service-doc': [{ href: 'https://auth.example.com/api/docs', type: 'text/html' }],
          'service-meta': [
            { href: 'https://auth.example.com/.well-known/oauth-protected-resource/api', type: 'application/json' },
          ],
          status: [{ href: 'https://auth.example.com/api/health', type: 'application/json' }],
        },
      ],
    })
    expect(await (await request('/robots.txt')).text()).toContain('Sitemap: https://auth.example.com/sitemap.xml')
    const sitemap = await request('/sitemap.xml')
    expect(sitemap.headers.get('Content-Type')).toContain('application/xml')
    expect(await sitemap.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://auth.example.com/</loc></url>\n  <url><loc>https://auth.example.com/api/docs</loc></url>\n</urlset>\n',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, 'text/html'],
    ['*/*', 'text/html'],
    ['text/html,application/xhtml+xml,*/*;q=0.8', 'text/html'],
    ['text/markdown', 'text/markdown'],
    ['text/markdown;q=0', 'text/html'],
    ['text/markdown;q=0.2,text/html;q=0.8', 'text/html'],
    ['text/markdown;q=0.2,*/*;q=0.8', 'text/html'],
    ['text/markdown;q=0.8,text/html;q=0.2', 'text/markdown'],
  ])('negotiates %s as %s', async (accept, contentType) => {
    const { request, fetch } = fixture()
    const response = await request('/', { headers: accept ? { Accept: accept } : {} })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain(contentType)
    expect(response.headers.get('Vary')).toContain('Accept')
    expect(response.headers.get('Link')).toContain('rel="api-catalog"')
    if (contentType === 'text/html') {
      expect(await response.text()).toBe('<html>Realmroot</html>')
      expect(response.headers.get('Vary')).toContain('Accept-Encoding')
      expect(fetch).toHaveBeenCalledOnce()
    } else {
      expect(await response.text()).toContain('[OpenAPI contract](/api/openapi.json)')
      expect(response.headers.has('ETag')).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('serves HEAD metadata without a body', async () => {
    const { request } = fixture()
    for (const path of ['/', '/llms.txt', '/robots.txt', '/sitemap.xml', '/.well-known/api-catalog', '/openapi.json']) {
      const response = await request(path, { method: 'HEAD', headers: { Accept: 'text/markdown' } })
      expect(await response.text()).toBe('')
      expect(response.status).toBe(path === '/openapi.json' ? 308 : 200)
    }
  })
})

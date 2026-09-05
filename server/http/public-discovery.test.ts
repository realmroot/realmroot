import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { serveHomepage } from './public-discovery'

function fixture() {
  const fetch = vi.fn(async (request: Request) => {
    const markdown = new URL(request.url).pathname === '/llms.txt'
    return new Response(
      request.method === 'HEAD'
        ? null
        : markdown
          ? '# Realmroot\n[OpenAPI contract](/api/openapi.json)'
          : '<html>Realmroot</html>',
      {
        headers: {
          'Content-Type': markdown ? 'text/markdown' : 'text/html',
          Vary: 'Accept-Encoding',
          ETag: markdown ? '"markdown"' : '"html"',
        },
      },
    )
  })
  return {
    fetch,
    request: (path: string, init?: RequestInit) =>
      serveHomepage(new Request(`https://auth.example.com${path}`, init), { fetch }),
  }
}

describe('public service discovery', () => {
  it('publishes static discovery files [spec: management-api/public-service-discovery]', () => {
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
      expect(response.headers.get('ETag')).toBe('"markdown"')
      expect(fetch).toHaveBeenCalledOnce()
    }
  })

  it('forwards HEAD and conditional requests to the selected asset', async () => {
    const { request, fetch } = fixture()
    const response = await request('/', {
      method: 'HEAD',
      headers: { Accept: 'text/markdown', 'If-None-Match': '"markdown"' },
    })
    expect(await response.text()).toBe('')
    const forwarded = fetch.mock.calls[0][0]
    expect(forwarded.url).toBe('https://auth.example.com/llms.txt')
    expect(forwarded.method).toBe('HEAD')
    expect(forwarded.headers.get('If-None-Match')).toBe('"markdown"')
  })
})

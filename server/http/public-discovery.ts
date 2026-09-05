import { Hono } from 'hono'
import { parseAccept } from 'hono/utils/accept'

const discoveryLinks = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</api/openapi.json>; rel="service-desc"; type="application/json"',
  '</api/docs>; rel="service-doc"; type="text/html"',
  '</.well-known/oauth-protected-resource/api>; rel="service-meta"; type="application/json"',
  '</llms.txt>; rel="alternate"; type="text/markdown"',
].join(', ')

const aliases: Record<string, string> = {
  '/.well-known/oauth-authorization-server': '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/openid-configuration': '/api/auth/.well-known/openid-configuration',
  '/.well-known/oauth-protected-resource': '/.well-known/oauth-protected-resource/api',
  '/openapi.json': '/api/openapi.json',
}

export const publicDiscoveryPaths = [
  '/',
  '/llms.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/.well-known/api-catalog',
  ...Object.keys(aliases),
]

type DiscoveryEnv = {
  Bindings: { ASSETS: Pick<Fetcher, 'fetch'>; BETTER_AUTH_URL?: string }
}

export const publicDiscovery = new Hono<DiscoveryEnv>()

publicDiscovery.use('*', async (c, next) => {
  c.header('Link', discoveryLinks)
  c.header('Access-Control-Allow-Origin', '*')
  await next()
})

for (const [path, target] of Object.entries(aliases)) {
  publicDiscovery.get(path, (c) => c.redirect(target, 308))
}

publicDiscovery.get('/', async (c) => {
  c.header('Vary', 'Accept')
  if (prefersMarkdown(c.req.header('Accept'))) {
    c.header('Content-Type', 'text/markdown; charset=utf-8')
    return c.body(serviceMarkdown())
  }
  const response = await c.env.ASSETS.fetch(c.req.raw)
  const headers = new Headers(response.headers)
  headers.append('Vary', 'Accept')
  headers.set('Link', discoveryLinks)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
})

publicDiscovery.get('/llms.txt', (c) => {
  c.header('Content-Type', 'text/markdown; charset=utf-8')
  return c.body(serviceMarkdown())
})

publicDiscovery.get('/.well-known/api-catalog', (c) => {
  const origin = new URL(c.env.BETTER_AUTH_URL ?? c.req.url).origin
  c.header('Content-Type', 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"')
  return c.body(
    JSON.stringify({
      linkset: [
        {
          anchor: `${origin}/api`,
          'service-desc': [{ href: `${origin}/api/openapi.json`, type: 'application/json' }],
          'service-doc': [{ href: `${origin}/api/docs`, type: 'text/html' }],
          'service-meta': [{ href: `${origin}/.well-known/oauth-protected-resource/api`, type: 'application/json' }],
          status: [{ href: `${origin}/api/health`, type: 'application/json' }],
        },
      ],
    }),
  )
})

publicDiscovery.get('/robots.txt', (c) => {
  const origin = new URL(c.env.BETTER_AUTH_URL ?? c.req.url).origin
  return c.text(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`)
})

publicDiscovery.get('/sitemap.xml', (c) => {
  const origin = new URL(c.env.BETTER_AUTH_URL ?? c.req.url).origin
  c.header('Content-Type', 'application/xml; charset=utf-8')
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', '/api/docs'].map((path) => `  <url><loc>${origin}${path}</loc></url>`).join('\n')}\n</urlset>\n`,
  )
})

function prefersMarkdown(header: string | undefined) {
  if (!header) return false
  const ranges = parseAccept(header.toLowerCase())
  const quality = (type: string) => {
    for (const range of [type, 'text/*', '*/*']) {
      const match = ranges.find((entry) => entry.type === range)
      if (match) return match.q
    }
    return 0
  }
  return (
    ranges.some((entry) => entry.type === 'text/markdown') &&
    quality('text/markdown') > 0 &&
    quality('text/markdown') >= quality('text/html')
  )
}

function serviceMarkdown() {
  return `# Realmroot

> Identity and controller-approved authorization for people, applications, and AI agents.

The browser application provides sign-in, account management, and an administration console.
Agents use the published API and their own identity. Protected operations require the appropriate authorization scopes.

## Discover the API

- [API catalog](/.well-known/api-catalog)
- [OpenAPI contract](/api/openapi.json)
- [Interactive API documentation](/api/docs)
- [Service health](/api/health)
- [Protected resource metadata](/.well-known/oauth-protected-resource/api)
- [OAuth authorization server metadata](/.well-known/oauth-authorization-server/api/auth)
- [OpenID Connect metadata](/api/auth/.well-known/openid-configuration)

The OAuth issuer is this deployment's origin followed by /api/auth.
The protected API resource identifier is this deployment's origin followed by /api.
Root discovery redirects are convenience links; they do not change these identifiers.

## Agent access

- [Agent configuration](/.well-known/agent-configuration)
- [Agent Skills index](/.well-known/agent-skills/index.json)

Install the Realmroot skill from the index for enrollment, controller approval, resource discovery,
and authorized API access. The index also provides application and resource server integration skills.
Use an Agent's own identity and request only the scopes needed for the task.
`
}

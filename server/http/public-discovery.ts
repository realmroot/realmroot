import { parseAccept } from 'hono/utils/accept'

const discoveryLinks = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</api/openapi.json>; rel="service-desc"; type="application/json"',
  '</api/docs>; rel="service-doc"; type="text/html"',
  '</.well-known/oauth-protected-resource/api>; rel="service-meta"; type="application/json"',
  '</llms.txt>; rel="alternate"; type="text/markdown"',
].join(', ')

export async function serveHomepage(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
  const url = new URL(request.url)
  if (prefersMarkdown(request.headers.get('Accept') ?? undefined)) {
    url.pathname = '/llms.txt'
  }
  const response = await assets.fetch(new Request(url, request))
  const headers = new Headers(response.headers)
  headers.append('Vary', 'Accept')
  headers.set('Link', discoveryLinks)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

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

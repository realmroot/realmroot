const platformOrigin = 'https://fake-external.example'
const authorizationCodes = new Map<string, string>()
const observations = {
  authorizationRequests: 0,
  tokenExchanges: 0,
  tokenRefreshes: 0,
  apiRequests: 0,
  credentialInjected: false,
}

export default {
  async fetch(request: Request) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/__reset') {
      authorizationCodes.clear()
      Object.assign(observations, {
        authorizationRequests: 0,
        tokenExchanges: 0,
        tokenRefreshes: 0,
        apiRequests: 0,
        credentialInjected: false,
      })
      return Response.json({ ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/__state') {
      return Response.json(observations)
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return Response.json({
        issuer: platformOrigin,
        authorization_endpoint: `${platformOrigin}/oauth/authorize`,
        token_endpoint: `${platformOrigin}/oauth/token`,
        userinfo_endpoint: `${platformOrigin}/oauth/userinfo`,
      })
    }
    if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state')
      const challenge = url.searchParams.get('code_challenge')
      if (!redirectUri || !state || !challenge || url.searchParams.get('code_challenge_method') !== 'S256') {
        return Response.json({ error: 'invalid_authorization_request' }, { status: 400 })
      }
      const code = `code-${authorizationCodes.size + 1}`
      authorizationCodes.set(code, challenge)
      observations.authorizationRequests += 1
      const callback = new URL(redirectUri)
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', state)
      return Response.redirect(callback.toString())
    }
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      const form = new URLSearchParams(await request.text())
      if (!request.headers.get('authorization')?.startsWith('Basic ')) {
        return Response.json({ error: 'invalid_client' }, { status: 401 })
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (form.get('refresh_token') !== 'external-refresh-token') {
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        }
        observations.tokenRefreshes += 1
        return Response.json({
          access_token: 'refreshed-external-access-token',
          refresh_token: 'external-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid repo:read',
        })
      }
      const code = form.get('code')
      const verifier = form.get('code_verifier')
      const expectedChallenge = code ? authorizationCodes.get(code) : null
      if (!code || !verifier || expectedChallenge !== (await pkceChallenge(verifier))) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      authorizationCodes.delete(code)
      observations.tokenExchanges += 1
      return Response.json({
        access_token: 'initial-external-access-token',
        refresh_token: 'external-refresh-token',
        token_type: 'Bearer',
        expires_in: 1,
        scope: 'openid repo:read',
      })
    }
    if (request.method === 'GET' && url.pathname === '/oauth/userinfo') {
      if (request.headers.get('authorization') !== 'Bearer initial-external-access-token') {
        return Response.json({ error: 'invalid_token' }, { status: 401 })
      }
      return Response.json({ sub: 'external-account-42', name: 'Fake Repository Account' })
    }
    if (request.method === 'GET' && url.pathname === '/api/repos/42') {
      observations.apiRequests += 1
      observations.credentialInjected =
        request.headers.get('authorization') === 'Bearer refreshed-external-access-token'
      if (!observations.credentialInjected) {
        return Response.json({ error: 'invalid_token' }, { status: 401 })
      }
      return Response.json({ id: 42, name: 'agent-ready-repository' }, { headers: { 'x-ratelimit-remaining': '9' } })
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  },
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

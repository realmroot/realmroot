import { useEffect } from 'react'

const oidcStateStorageKey = 'flareauth.oidc.state'
const oidcVerifierStorageKey = 'flareauth.oidc.verifier'

export function OidcStartRoute({
  startAuthorization = () => startOidcAuthorization((url) => window.location.assign(url)),
}: {
  startAuthorization?: () => Promise<void>
}) {
  useEffect(() => {
    void startAuthorization()
  }, [startAuthorization])

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">OIDC client</p>
        <h1>Starting client sign-in</h1>
        <p className="intro">Opening the authorization request for the configured callback.</p>
      </section>
    </main>
  )
}

export function OidcCallbackRoute() {
  const params = new URLSearchParams(window.location.search)
  const state = params.get('state')
  const expectedState = window.sessionStorage.getItem(oidcStateStorageKey)
  const error = params.get('error')
  const code = params.get('code')
  const valid = !error && code && state && expectedState && state === expectedState

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">OIDC callback</p>
        <h1>Client callback</h1>
        {valid ? (
          <>
            <p className="intro">Authorization response validated for this client integration.</p>
            <code>{params.toString()}</code>
          </>
        ) : (
          <p className="intro">Authorization response is missing a valid code and state.</p>
        )}
      </section>
    </main>
  )
}

export async function startOidcAuthorization(redirect: (url: URL) => void) {
  const currentUrl = new URL(window.location.href)
  const state = randomUrlToken()
  const verifier = randomUrlToken()
  const authorizationUrl = new URL('/api/auth/oauth2/authorize', window.location.origin)

  window.sessionStorage.setItem(oidcStateStorageKey, state)
  window.sessionStorage.setItem(oidcVerifierStorageKey, verifier)

  authorizationUrl.searchParams.set('client_id', currentUrl.searchParams.get('client_id') ?? 'client-1')
  authorizationUrl.searchParams.set(
    'redirect_uri',
    currentUrl.searchParams.get('redirect_uri') ?? `${window.location.origin}/oidc/callback`,
  )
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', currentUrl.searchParams.get('scope') ?? 'openid profile')
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('code_challenge', await pkceChallenge(verifier))
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')

  redirect(authorizationUrl)
}

function randomUrlToken() {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function pkceChallenge(verifier: string) {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OidcCallbackRoute, OidcStartRoute, startOidcAuthorization } from './oidc-callback'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  window.history.pushState(null, '', '/')
})

describe('OidcCallbackRoute', () => {
  it('validates code and state from the local OIDC callback', () => {
    window.sessionStorage.setItem('flareauth.oidc.state', 'state-1')
    window.history.pushState(null, '', '/oidc/callback?code=code-1&state=state-1')

    render(<OidcCallbackRoute />)

    expect(screen.getByRole('heading', { name: 'Client callback' })).toBeTruthy()
    expect(screen.getByText('Authorization response validated for this client integration.')).toBeTruthy()
    expect(screen.getByText('code=code-1&state=state-1')).toBeTruthy()
  })

  it('rejects missing or mismatched callback state', () => {
    window.sessionStorage.setItem('flareauth.oidc.state', 'state-1')
    window.history.pushState(null, '', '/oidc/callback?code=code-1&state=bad-state')

    render(<OidcCallbackRoute />)

    expect(screen.getByText('Authorization response is missing a valid code and state.')).toBeTruthy()
  })

  it('starts the local OIDC flow by storing state and redirecting to native authorize', async () => {
    const redirects: string[] = []
    vi.spyOn(window.crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array
      bytes.fill(1)
      return array
    })
    vi.spyOn(window.crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([2, 3, 4]).buffer)
    window.history.pushState(
      null,
      '',
      '/oidc/start?client_id=client-1&redirect_uri=http%3A%2F%2Flocalhost%3A4173%2Foidc%2Fcallback&scope=openid%20email',
    )

    render(<OidcStartRoute startAuthorization={async () => undefined} />)

    expect(await screen.findByRole('heading', { name: 'Starting client sign-in' })).toBeTruthy()
    expect(screen.getByText('OIDC client')).toBeTruthy()
    expect(screen.getByText('Opening the authorization request for the configured callback.')).toBeTruthy()
    await startOidcAuthorization((url) => redirects.push(String(url)))
    const redirect = new URL(redirects[0] ?? '')
    expect(redirect.pathname).toBe('/api/auth/oauth2/authorize')
    expect(redirect.searchParams.get('client_id')).toBe('client-1')
    expect(redirect.searchParams.get('redirect_uri')).toBe('http://localhost:4173/oidc/callback')
    expect(redirect.searchParams.get('scope')).toBe('openid email')
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256')
    expect(window.sessionStorage.getItem('flareauth.oidc.state')).toBe(redirect.searchParams.get('state'))
    expect(window.sessionStorage.getItem('flareauth.oidc.verifier')).toBeTruthy()
  })

  it('runs the default OIDC start authorization effect', async () => {
    vi.spyOn(window.crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array
      bytes.fill(1)
      return array
    })
    vi.spyOn(window.crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([2, 3, 4]).buffer)

    render(<OidcStartRoute />)

    expect(await screen.findByRole('heading', { name: 'Starting client sign-in' })).toBeTruthy()
    await vi.waitFor(() => expect(window.sessionStorage.getItem('flareauth.oidc.state')).toBeTruthy())
  })

  it('builds a PKCE authorization redirect by default', async () => {
    const redirects: string[] = []
    vi.spyOn(window.crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array
      bytes.fill(1)
      return array
    })
    vi.spyOn(window.crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([2, 3, 4]).buffer)

    await startOidcAuthorization((url) => redirects.push(String(url)))

    const redirect = new URL(redirects[0] ?? '')
    expect(redirect.pathname).toBe('/api/auth/oauth2/authorize')
    expect(redirect.searchParams.get('code_challenge')).toBe('AgME')
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256')
    expect(redirect.searchParams.get('state')).toBeTruthy()
    expect(window.sessionStorage.getItem('flareauth.oidc.state')).toBeTruthy()
    expect(window.sessionStorage.getItem('flareauth.oidc.verifier')).toBeTruthy()
  })
})

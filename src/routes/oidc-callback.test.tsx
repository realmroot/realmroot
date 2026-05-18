import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OidcCallbackRoute } from './oidc-callback'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  window.history.pushState(null, '', '/')
})

describe('OidcCallbackRoute', () => {
  it('validates code and state from the local demo callback', () => {
    window.sessionStorage.setItem('flareauth.demo.oidcState', 'state-1')
    window.history.pushState(null, '', '/oidc/callback?code=code-1&state=state-1')

    render(<OidcCallbackRoute />)

    expect(screen.getByRole('heading', { name: 'Demo client callback' })).toBeTruthy()
    expect(screen.getByText('Authorization response validated for local integration testing.')).toBeTruthy()
    expect(screen.getByText('code=code-1&state=state-1')).toBeTruthy()
  })

  it('rejects missing or mismatched callback state', () => {
    window.sessionStorage.setItem('flareauth.demo.oidcState', 'state-1')
    window.history.pushState(null, '', '/oidc/callback?code=code-1&state=bad-state')

    render(<OidcCallbackRoute />)

    expect(screen.getByText('Authorization response is missing a valid code and state.')).toBeTruthy()
  })
})

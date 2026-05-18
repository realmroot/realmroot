import { afterEach, describe, expect, it } from 'vitest'
import { callbackURL } from './hooks'

afterEach(() => {
  window.history.pushState(null, '', '/')
})

describe('auth callback URL resolution', () => {
  it('returns the provider authorize endpoint for OAuth authorize query parameters', () => {
    window.history.pushState(
      null,
      '',
      '/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )

    expect(callbackURL()).toBe(
      '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
  })

  it('uses explicit hosted callback parameters for non-OAuth flows', () => {
    window.history.pushState(null, '', '/sign-in?callbackURL=%2Faccount&redirect_uri=https%3A%2F%2Fclient.example.com')

    expect(callbackURL()).toBe('/account')
  })
})

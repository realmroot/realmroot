import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRouter, queryClient } from '@/router'

vi.mock('@/routes/account', () => ({
  AccountRoute: () => <h1>Profile route</h1>,
}))

vi.mock('@/routes/onboarding', () => ({
  OnboardingRoute: () => <h1>First-admin onboarding</h1>,
}))

vi.mock('@/routes/sign-in', () => ({
  SignInRoute: () => <h1>Sign in route</h1>,
}))

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('root route', () => {
  it('redirects signed-out root visits to sign-in without a return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz(false)))
      if (url === '/api/account/profile') {
        return Promise.resolve(jsonResponse({ error: 'Authentication is required.' }, 401))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in route' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(window.location.search).toBe('')
  })

  it('redirects signed-in root visits to the profile entry point', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz(false)))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user }))
      return Promise.resolve(jsonResponse({}))
    })

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Profile route' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/profile'))
  })

  it('preserves first-admin onboarding ahead of root auth redirects', async () => {
    const requestedUrls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz(true)))
      return Promise.resolve(jsonResponse({}))
    })

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'First-admin onboarding' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/onboarding'))
    expect(requestedUrls).not.toContain('/api/account/profile')
  })

  it('preserves return_to on protected profile routes', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz(false)))
      if (url === '/api/account/profile') {
        return Promise.resolve(jsonResponse({ error: 'Authentication is required.' }, 401))
      }
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/profile')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in route' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(new URLSearchParams(window.location.search).get('return_to')).toBe('/profile')
  })
})

const user = {
  id: 'user-1',
  email: 'jane@example.com',
  name: 'Jane Stone',
  displayName: 'Jane Stone',
  username: 'jane',
  role: 'user',
}

function configz(onboardingRequired: boolean) {
  return {
    onboarding: { required: onboardingRequired, href: '/onboarding' },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRouter, queryClient } from '@/router'
import { ApplicationsPage, UsersPage } from './admin-console'

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('admin console', () => {
  it('redirects unauthorized admin routes to sign-in with the requested return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings')
        return Promise.resolve(jsonResponse({ error: 'Unauthorized' }, 401))
      if (url === '/api/experience') return Promise.resolve(jsonResponse(experienceConfig))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/admin/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(decodeURIComponent(window.location.search)).toContain('return_to=/admin/applications')
  })

  it('redirects forbidden admin routes to sign-in with return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse({ error: 'Forbidden' }, 403))
      if (url === '/api/experience') return Promise.resolve(jsonResponse(experienceConfig))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/admin/users')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(window.location.search).toContain('return_to=')
  })

  it('renders application rows and posts validated create input', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Admin console' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'admin-console' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://app.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/applications',
          body: {
            name: 'Admin console',
            slug: 'admin-console',
            clientType: 'public_spa',
            redirectUris: ['https://app.example.com/callback'],
          },
        },
      ])
    })
  })

  it('shows client-side validation errors and does not post invalid application input', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Admin console' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'not valid' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://app.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Invalid string: must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('renders users and displays management API errors from create flow', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/users' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Email already exists.' } }, 400))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Email already exists.')).toBeTruthy()
  })
})

function renderWithQuery(children: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const pagination = {
  limit: 50,
  offset: 0,
  total: 1,
  hasMore: false,
  nextOffset: null,
}

const application = {
  id: 'app-1',
  slug: 'customer-portal',
  name: 'Customer portal',
  description: null,
  homepageUrl: null,
  iconUrl: null,
  clientId: 'client-1',
  clientType: 'public_spa',
  public: true,
  firstParty: true,
  trusted: true,
  disabled: false,
  disabledReason: null,
  redirectUris: ['https://app.example.com/callback'],
  allowedGrantTypes: ['authorization_code'],
  allowedScopes: ['openid', 'profile'],
  requirePkce: true,
  tokenEndpointAuthMethod: 'none',
  secretMetadata: [],
  oidc: {
    issuer: 'https://auth.example.com',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    jwksUri: 'https://auth.example.com/jwks',
    userInfoEndpoint: 'https://auth.example.com/userinfo',
    endSessionEndpoint: 'https://auth.example.com/logout',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const user = {
  id: 'user-1',
  email: 'jane@example.com',
  name: 'Jane Doe',
  role: 'admin',
  banned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const experienceConfig = {
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: false,
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: false,
    identifierFirst: false,
  },
  branding: {
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    backgroundColor: null,
    customCss: null,
  },
  identityProviders: [],
  links: {
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
  },
  copy: {
    productName: 'Acme',
    headline: 'Sign in to Acme.',
    description: 'Use your workspace identity.',
  },
  defaults: {
    applicationId: null,
    redirectUri: null,
  },
}

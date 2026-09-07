import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthErrorPage, RouteErrorPage } from '@/features/auth/error-page'
import { readJsonResponse } from '@/lib/api'
import { nativeAuth } from '@/lib/auth-client'
import { routeTree } from '@/routeTree.gen'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('[spec: hosted-auth/hosted-auth-error-flow] hosted errors', () => {
  it('shows resource visibility details and fixed recovery links without fetching configuration', () => {
    const message = 'Requested Resource Server is not visible to this principal.'
    window.history.replaceState(
      null,
      '',
      `/auth/error?${new URLSearchParams({ error: 'invalid_target', error_description: message, redirect_uri: 'https://untrusted.example' })}`,
    )
    const fetch = vi.spyOn(window, 'fetch')
    render(<AuthErrorPage />)
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.getByText('invalid_target')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/auth/sign-in')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    'invalid_target',
    'access_denied',
    'unknown_code',
  ])('explains errors even when %s has no description', (code) => {
    window.history.replaceState(null, '', `/auth/error?error=${code}`)
    render(<AuthErrorPage />)
    expect(screen.getByRole('alert').textContent).not.toBe(code)
    expect(screen.getByText(code)).toBeTruthy()
  })

  it('treats error descriptions as text and missing context as failure', () => {
    window.history.replaceState(
      null,
      '',
      `/auth/error?${new URLSearchParams({ error_description: '<script>alert(1)</script>' })}`,
    )
    render(<AuthErrorPage />)
    expect(screen.getByRole('alert').textContent).toBe('<script>alert(1)</script>')
    expect(document.querySelector('script')).toBeNull()
    cleanup()
    window.history.replaceState(null, '', '/auth/error')
    render(<AuthErrorPage />)
    expect(screen.getByRole('alert').textContent).toBe('Unable to complete this request. Please try again.')
  })

  it.each([
    '/auth/consent',
    '/auth/context',
    '/auth/device',
    '/profile',
  ])('shows route admission errors on %s', async (path) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(window, 'fetch').mockResolvedValue(
      Response.json({ error: { code: 'forbidden', message: 'This account is unavailable.' } }, { status: 403 }),
    )
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
      context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    })
    render(<RouterProvider router={router} />)
    expect((await screen.findByRole('alert')).textContent).toBe('This account is unavailable.')
    expect(screen.getByRole('heading', { name: 'Unable to open this page.' })).toBeTruthy()
  })

  it('shows unexpected failures without rendering internal error details', () => {
    render(<RouteErrorPage error={new Error('internal stack detail')} reset={() => undefined} />)
    expect(screen.getByRole('alert').textContent).toBe('Unable to load this page. Please reload it or try again later.')
    expect(document.body.textContent).not.toContain('internal stack detail')
  })

  it('shows a recovery page for unknown routes', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/missing-page'] }),
      context: { queryClient: new QueryClient() },
    })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: 'Page not found.' })).toBeTruthy()
  })

  it('preserves OAuth descriptions for consent and device API failures', async () => {
    const message = 'Requested Resource Server is not visible to this principal.'
    vi.spyOn(window, 'fetch').mockImplementation(async () =>
      Response.json({ error: 'invalid_target', error_description: message }, { status: 400 }),
    )
    await expect(nativeAuth('/oauth2/consent', { accept: true })).rejects.toMatchObject({ message, status: 400 })
    await expect(
      readJsonResponse(Response.json({ error: 'invalid_target', error_description: message }, { status: 400 })),
    ).rejects.toMatchObject({ message, status: 400 })
  })
})

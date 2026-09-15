import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountRouteFetch } from '@/features/console/console.test-utils'
import { queryClientDefaultOptions } from '@/lib/query-client'
import { AppRouter, queryClient } from '@/router'

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('Account Center route navigation', () => {
  it('keeps the shared layout mounted and reuses common data between sections', async () => {
    queryClient.setDefaultOptions(queryClientDefaultOptions)
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)
    window.history.pushState(null, '', '/profile')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeTruthy()
    const shell = document.querySelector('.accountShell')
    const topbar = document.querySelector('.accountProductTopbar')
    fetchSpy.mockClear()

    await userEvent.click(screen.getByRole('link', { name: 'Sign-in & security' }))

    expect(await screen.findByRole('heading', { name: 'Sign-in & security' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/security'))
    expect(document.querySelector('.accountShell')).toBe(shell)
    expect(document.querySelector('.accountProductTopbar')).toBe(topbar)
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/account/provider-connections?page=1&pageSize=100',
    ])
  })

  it('opens Data & privacy as a route-backed account section', async () => {
    queryClient.setDefaultOptions(queryClientDefaultOptions)
    vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)
    window.history.pushState(null, '', '/data-privacy')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Data & privacy' })).toBeTruthy()
    const activeLink = screen.getByRole('link', { name: 'Data & privacy' })
    expect(activeLink.getAttribute('href')).toBe('/data-privacy')
    expect(activeLink.getAttribute('aria-current')).toBe('page')
    const linkNames = screen.getAllByRole('link').map((link) => link.textContent?.trim())
    const securityLinkIndex = linkNames.indexOf('Sign-in & security')
    expect(linkNames.slice(securityLinkIndex, securityLinkIndex + 2)).toEqual(['Sign-in & security', 'Data & privacy'])
    expect(screen.getByText('Export account data')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeTruthy()
  })
})

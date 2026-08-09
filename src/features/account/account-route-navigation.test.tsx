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
      '/api/account/provider-connections?limit=100&offset=0',
    ])
  })
})

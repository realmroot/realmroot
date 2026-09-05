import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRouter, queryClient } from '@/router'
import { consoleRouteFetch } from './console.test-utils'

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('deferred Console configuration', () => {
  it('keeps deferred audit logs out of the Console', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/audit-logs')
    render(<AppRouter />)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Audit logs' })).toBeNull())
    expect(screen.queryByLabelText('Search audit logs')).toBeNull()
  })
})

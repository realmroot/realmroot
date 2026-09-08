import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteAccountPanel } from './delete-account-panel'

const remove = vi.fn()
vi.mock('@/lib/api/account', () => ({ deleteOwnAccount: () => remove() }))
vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }))
afterEach(() => {
  cleanup()
  remove.mockReset()
})

describe('account deletion confirmation', () => {
  it('requires a second confirmation and preserves actionable failures [spec: account-center/account-deletion-confirmation]', async () => {
    remove.mockRejectedValue(new Error('Transfer ownership first.'))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DeleteAccountPanel />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(/Your profile and sign-in credentials will be erased/)).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Transfer ownership first.'))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Permanently delete account' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

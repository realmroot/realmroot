import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signOut } from '@/lib/auth-client'
import { DeleteAccountPanel } from './delete-account-panel'

const remove = vi.fn()
const assign = vi.fn()
const replace = vi.fn()
beforeEach(() => vi.stubGlobal('location', { ...window.location, assign, replace }))
vi.mock('@/lib/api/account', () => ({ deleteOwnAccount: () => remove() }))
vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }))
afterEach(() => {
  cleanup()
  remove.mockReset()
  vi.mocked(signOut).mockReset()
  assign.mockReset()
  replace.mockReset()
  vi.unstubAllGlobals()
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

function openPanel() {
  const client = new QueryClient()
  client.setQueryData(['profile'], { id: 'user-1' })
  render(
    <QueryClientProvider client={client}>
      <DeleteAccountPanel />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
  return client
}

it('locks repeated confirmation while deleting and clears private state only after success', async () => {
  let complete!: () => void
  remove.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  const client = openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }))
  expect(screen.getByRole('button', { name: 'Deleting…' }).hasAttribute('disabled')).toBe(true)
  expect(client.getQueryData(['profile'])).toEqual({ id: 'user-1' })
  expect(replace).not.toHaveBeenCalled()
  complete()
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/auth/account-deleted'))
  expect(client.getQueryData(['profile'])).toBeUndefined()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Delete account' }).hasAttribute('disabled')).toBe(true)
})

it('shows a useful message for a non-Error deletion rejection and allows another attempt', async () => {
  remove.mockRejectedValueOnce(null).mockResolvedValueOnce(undefined)
  openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Unable to delete account.'))
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }))
  await waitFor(() => expect(replace).toHaveBeenCalled())
})

it('reauthenticates by signing out, clearing private state and returning to security after sign-in', async () => {
  vi.mocked(signOut).mockResolvedValue({})
  const client = openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/sign-in?return_to=%2Fsecurity'))
  expect(client.getQueryData(['profile'])).toBeUndefined()
  expect(remove).not.toHaveBeenCalled()
})

it.each([
  [new Error('Sign out failed.'), 'Sign out failed.'],
  [null, 'Unable to sign out.'],
])('preserves private state and allows retry when reauthentication fails: %s', async (cause, message) => {
  vi.mocked(signOut).mockRejectedValue(cause)
  const client = openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message))
  expect(assign).not.toHaveBeenCalled()
  expect(client.getQueryData(['profile'])).toEqual({ id: 'user-1' })
  expect(screen.getByRole('button', { name: 'Sign in again' }).hasAttribute('disabled')).toBe(false)
})

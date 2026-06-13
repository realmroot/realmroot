import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountPageShell } from '@/features/account/account-shell'
import { defaultAccountCenterSettings } from '@/features/account/settings'
import type { UserProfile } from '@/features/account/types'

const navigate = vi.fn().mockResolvedValue(undefined)
const signOut = vi.fn().mockResolvedValue({})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}))

vi.mock('@/lib/auth-client', () => ({
  signOut: () => signOut(),
}))

afterEach(() => {
  cleanup()
  navigate.mockClear()
  signOut.mockClear()
  window.history.pushState(null, '', '/')
})

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    emailVerified: true,
    displayName: 'Jane Stone',
    username: 'jane',
    avatarAssetId: null,
    image: null,
    role: 'user',
    ...overrides,
  } as UserProfile
}

function renderShell(profileValue: UserProfile | null) {
  render(
    <AccountPageShell
      accountCenter={defaultAccountCenterSettings}
      config={null}
      profile={profileValue}
      section="profile"
    >
      <div>Account content</div>
    </AccountPageShell>,
  )
}

describe('AccountPageShell', () => {
  it('includes a Console entry in the avatar menu for admins [spec: account-center/account-admin-console-entry]', async () => {
    renderShell(profile({ role: 'admin' }))

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))

    const consoleLink = await screen.findByRole('link', { name: 'Console' })
    expect(consoleLink.getAttribute('href')).toBe('/console')
  })

  it('hides the Console entry from the avatar menu for non-admins', async () => {
    renderShell(profile({ role: 'user' }))

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))

    await screen.findByText('jane@example.com')
    expect(screen.queryByRole('link', { name: 'Console' })).toBeNull()
  })

  it('signs out and redirects to hosted sign-in [spec: account-center/sign-out]', async () => {
    renderShell(profile())

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in' }))
  })
})

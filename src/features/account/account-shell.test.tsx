import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountPageShell } from '@/features/account/account-shell'
import { type AccountCenterSection, defaultAccountCenterSettings } from '@/features/account/settings'
import type { UserProfile } from '@/features/account/types'
import { i18n } from '@/lib/i18n'

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
  void i18n.changeLanguage('en')
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

function renderShell(profileValue: UserProfile, section: AccountCenterSection = 'profile') {
  const platformOperator = profileValue.role === 'admin'
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <AccountPageShell
        access={{
          canCreateOrganization: platformOperator,
          showOrganizations: platformOperator,
          platformOperator,
          consoleOrganizations: [],
        }}
        accountCenter={defaultAccountCenterSettings}
        config={null}
        profile={profileValue}
        section={section}
      >
        <div>Account content</div>
      </AccountPageShell>
    </QueryClientProvider>,
  )
  return queryClient
}

function openAccountMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: /Account menu|账户/ }), {
    button: 0,
    ctrlKey: false,
  })
}

async function openPreferenceSubmenu(name: RegExp) {
  const trigger = await screen.findByRole('menuitem', { name })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowRight' })
}

describe('AccountPageShell', () => {
  it('includes a Console entry in the avatar menu for admins [spec: account-center/account-admin-console-entry]', async () => {
    renderShell(profile({ role: 'admin' }))

    expect(screen.queryByRole('link', { name: 'Open Realm Console' })).toBeNull()
    openAccountMenu()

    const consoleLink = await screen.findByRole('link', { name: 'Console' })
    expect(consoleLink.getAttribute('href')).toBe('/console')
  })

  it('hides the Console entry from the avatar menu for non-admins', async () => {
    renderShell(profile({ role: 'user' }))

    openAccountMenu()

    expect((await screen.findAllByText('jane@example.com')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Console' })).toBeNull()
  })

  it('signs out and redirects to hosted sign-in [spec: account-center/sign-out]', async () => {
    const queryClient = renderShell(profile())
    const clear = vi.spyOn(queryClient, 'clear')

    openAccountMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(clear).toHaveBeenCalledOnce()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in' }))
  })

  it('does not redirect when sign out fails', async () => {
    signOut.mockRejectedValueOnce(new Error('Sign out failed.'))
    renderShell(profile())

    openAccountMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('uses the stable account error message for a non-Error sign-out failure', async () => {
    signOut.mockRejectedValueOnce('offline')
    renderShell(profile())

    openAccountMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('applies the settings surface only to Profile and Security sections', () => {
    renderShell(profile(), 'security')
    expect(document.querySelector('.accountContent')?.className).toContain('is-settings')
    cleanup()

    renderShell(profile(), 'overview')
    expect(document.querySelector('.accountContent')?.className).not.toContain('is-settings')
  })

  it('renders the avatar image when the profile has one', async () => {
    const OriginalImage = window.Image
    class LoadedImage {
      private listeners = new Map<string, EventListener>()
      addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, listener)
      }
      removeEventListener(type: string) {
        this.listeners.delete(type)
      }
      set src(_value: string) {
        queueMicrotask(() => this.listeners.get('load')?.(new Event('load')))
      }
    }
    Object.defineProperty(window, 'Image', { configurable: true, value: LoadedImage })
    renderShell(profile({ image: 'https://cdn.example.com/avatar.png' }))
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    await waitFor(() =>
      expect(trigger.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/avatar.png'),
    )
    Object.defineProperty(window, 'Image', { configurable: true, value: OriginalImage })
  })

  it('does not show placeholder realm details in the sidebar [spec: account-center/account-center]', () => {
    renderShell(profile())

    expect(screen.queryByText('Default realm')).toBeNull()
    expect(screen.queryByText('identity.acme.dev')).toBeNull()
  })

  it('returns focus to the Account Center navigation trigger after Escape', async () => {
    renderShell(profile())
    const trigger = screen.getByRole('button', { name: 'Open Account Center navigation' })

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Account Center' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Account Center' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('switches language and theme from the avatar submenus', async () => {
    renderShell(profile())
    openAccountMenu()
    await openPreferenceSubmenu(/^Theme/)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))

    openAccountMenu()
    await openPreferenceSubmenu(/^Theme/)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Light' }))

    openAccountMenu()
    await openPreferenceSubmenu(/^Language/)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '简体中文' }))
    await waitFor(() => expect(i18n.language).toBe('zh'))

    openAccountMenu()
    await openPreferenceSubmenu(/Language|语言/)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))
    await waitFor(() => expect(i18n.language).toBe('en'))
  })
})

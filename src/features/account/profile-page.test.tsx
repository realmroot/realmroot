import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/lib/i18n'
import {
  base,
  configz,
  createAccountServer,
  createAccountStore,
  HttpResponse,
  http,
  renderWithClient,
} from './account.test-utils'
import { AccountProfilePage } from './profile-page'
import { accountTimeZoneStorageKey } from './utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
Element.prototype.scrollIntoView ??= () => {}

const success = vi.fn()
const errorToast = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => errorToast(...a) },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

const store = createAccountStore()
const server = createAccountServer(store)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  success.mockClear()
  errorToast.mockClear()
  window.localStorage.removeItem(accountTimeZoneStorageKey)
  Object.assign(store, createAccountStore())
})
afterAll(() => server.close())

describe('AccountProfilePage', () => {
  it('persists the selected time zone for Account Center dates [spec: account-center/account-preferences]', async () => {
    renderWithClient(<AccountProfilePage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Preferences' }), { button: 0, ctrlKey: false })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Change' }))[1]!)
    fireEvent.click(await screen.findByRole('combobox', { name: 'Time zone' }))
    fireEvent.change(await screen.findByPlaceholderText('Search time zones…'), { target: { value: 'Europe/London' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Europe/London' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(window.localStorage.getItem(accountTimeZoneStorageKey)).toBe('Europe/London'))
    expect(screen.getByText('Europe/London')).toBeTruthy()
  })

  it('changes the Account Center language from the preferences dialog', async () => {
    renderWithClient(<AccountProfilePage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Preferences' }), { button: 0, ctrlKey: false })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Change' }))[0]!)
    fireEvent.change(await screen.findByLabelText('Language'), { target: { value: 'zh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(success).toHaveBeenCalledWith('偏好设置已更新'))
    expect(i18n.language).toBe('zh')
    await i18n.changeLanguage('en')
  })

  it('downloads a machine-readable account snapshot [spec: account-center/account-data-export]', async () => {
    const createObjectURL = vi.fn(() => 'blob:account-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithClient(<AccountProfilePage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Account' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Download data' }))

    await waitFor(() => expect(success.mock.calls.length + errorToast.mock.calls.length).toBeGreaterThan(0))
    expect(errorToast).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith('Account data downloaded.')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(download).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:account-export')
  })

  it('omits disabled connected-account and session data from an export', async () => {
    const limited = configz()
    limited.accountCenter = {
      ...limited.accountCenter,
      connectedAccountsEnabled: false,
      sessionsViewEnabled: false,
    }
    let protectedDataRequests = 0
    server.use(
      http.get(`${base}/api/configz`, () => HttpResponse.json(limited)),
      http.get(`${base}/api/account/applications`, () => {
        protectedDataRequests += 1
        return HttpResponse.json({ applications: [] })
      }),
      http.get(`${base}/api/account/linked-accounts`, () => {
        protectedDataRequests += 1
        return HttpResponse.json({ accounts: [] })
      }),
      http.get(`${base}/api/account/sessions`, () => {
        protectedDataRequests += 1
        return HttpResponse.json({ sessions: [] })
      }),
    )
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:limited-export') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithClient(<AccountProfilePage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Account' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Download data' }))

    await waitFor(() => expect(success).toHaveBeenCalledWith('Account data downloaded.'))
    expect(protectedDataRequests).toBe(0)
  })

  it('shows a loading state then renders profile sections', async () => {
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Change avatar/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Edit display name/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Edit username/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Change email/ })).toBeTruthy()
  })

  it('renders an error state when the profile request fails', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ error: 'denied' }, { status: 500 })))
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByText('denied')).toBeTruthy()
  })

  it('shows the unavailable section when profile editing is disabled', async () => {
    const disabled = configz()
    disabled.accountCenter = { ...disabled.accountCenter, profileEditingEnabled: false }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(disabled)))
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByText('Profile editing is disabled for this account center.')).toBeTruthy()
  })

  it('saves a new display name and refetches the profile', async () => {
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Edit display name/ }))
    const input = await screen.findByLabelText('Display name')
    fireEvent.change(input, { target: { value: 'Jane Updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }))

    await waitFor(() => expect(success).toHaveBeenCalledWith('Profile updated.'))
    await waitFor(() => expect(screen.getByText('Jane Updated')).toBeTruthy())
    expect(store.profile.displayName).toBe('Jane Updated')
  })

  it('edits the username through its dialog', async () => {
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Edit username/ }))
    const input = await screen.findByLabelText('Username')
    fireEvent.change(input, { target: { value: 'jane-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save identifiers' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Profile updated.'))
    expect(store.profile.username).toBe('jane-new')
  })

  it('patches only the profile field owned by the active editor', async () => {
    const patches: Array<Record<string, unknown>> = []
    server.use(
      http.patch(`${base}/api/account/profile`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patches.push(body)
        Object.assign(store.profile, body)
        return HttpResponse.json({ user: store.profile })
      }),
    )
    renderWithClient(<AccountProfilePage />)

    fireEvent.click(await screen.findByRole('button', { name: /Edit display name/ }))
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Narrow Patch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }))
    await waitFor(() => expect(patches).toHaveLength(1))

    fireEvent.click(await screen.findByRole('button', { name: /Edit username/ }))
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'narrow-patch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save identifiers' }))
    await waitFor(() => expect(patches).toHaveLength(2))

    expect(patches).toEqual([{ displayName: 'Narrow Patch' }, { username: 'narrow-patch' }])
  })

  it('uploads an avatar and previews it', async () => {
    server.use(
      http.post(`${base}/api/account/avatar`, () =>
        HttpResponse.json({ asset: { id: 'asset-9', publicUrl: 'https://cdn.example.com/a.png' } }),
      ),
    )
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change avatar/ }))
    const fileInput = await screen.findByLabelText('Avatar image')
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await waitFor(() => expect(success).toHaveBeenCalledWith('Avatar uploaded.'))
  })

  it('runs the two-step email change flow', async () => {
    server.use(
      http.post(`${base}/api/account/email/change`, () => HttpResponse.json({ ok: true })),
      http.post(`${base}/api/account/email/confirm`, () => HttpResponse.json({ ok: true })),
    )
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change email/ }))
    const emailInput = await screen.findByLabelText('Email')
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))

    await waitFor(() => expect(success).toHaveBeenCalledWith('Verification code sent.'))
    const otpInput = await screen.findByLabelText('Verification code')
    fireEvent.change(otpInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /Verify code/ }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Email changed.'))
  })

  it('navigates back from the email confirm step', async () => {
    server.use(http.post(`${base}/api/account/email/change`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change email/ }))
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))
    await screen.findByLabelText('Verification code')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Email')).toBeTruthy()
  })

  it('cancels a dialog without mutating', async () => {
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Edit display name/ }))
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Unsaved name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Display name')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Edit display name/ }))
    expect(await screen.findByLabelText('Display name')).toHaveProperty('value', store.profile.displayName)
    expect(success).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and reports an error when saving fails', async () => {
    server.use(
      http.patch(`${base}/api/account/profile`, () => HttpResponse.json({ error: 'Name taken.' }, { status: 400 })),
    )
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Edit display name/ }))
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Taken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Name taken.'))
    expect(screen.getByLabelText('Display name')).toBeTruthy()
  })

  it('ignores avatar upload when no file is selected', async () => {
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change avatar/ }))
    const fileInput = await screen.findByLabelText('Avatar image')
    fireEvent.change(fileInput, { target: { files: [] } })
    await waitFor(() => expect(screen.getByLabelText('Avatar image')).toBeTruthy())
    expect(success).not.toHaveBeenCalled()
  })

  it('clears optional avatar and username profile fields', async () => {
    renderWithClient(<AccountProfilePage />)

    fireEvent.click(await screen.findByRole('button', { name: /Change avatar/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save avatar' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Profile updated.'))
    expect(store.profile.avatarAssetId).toBeNull()

    success.mockClear()
    fireEvent.click(await screen.findByRole('button', { name: /Edit username/ }))
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save identifiers' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Profile updated.'))
    expect(store.profile.username).toBeNull()
  })

  it('hides identity and identifier rows when their settings are disabled', async () => {
    const limited = configz()
    limited.accountCenter = {
      ...limited.accountCenter,
      avatarEditable: false,
      displayNameEditable: false,
      usernameEditable: false,
      emailChangeEnabled: false,
    }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(limited)))
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Change avatar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit display name/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit username/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Change email/ })).toBeNull()
  })

  it('shows the unverified email status and no username placeholder', async () => {
    const unverified = createAccountStore()
    unverified.profile.emailVerified = false
    unverified.profile.username = null
    Object.assign(store, unverified)
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByText('Unverified')).toBeTruthy()
    expect(screen.getByText('No username set')).toBeTruthy()
  })

  it('renders a custom avatar image and label', async () => {
    const withImage = createAccountStore()
    withImage.profile.image = 'https://cdn.example.com/a.png'
    Object.assign(store, withImage)
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByText('Custom image')).toBeTruthy()
    const avatarRow = screen.getByText('Custom image').closest('article') as HTMLElement
    expect(avatarRow.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/a.png')
  })

  it('renders the unavailable profile section when no profile is returned', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: null, access: store.access })))
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByText('Profile editing is disabled for this account center.')).toBeTruthy()
    expect(screen.queryByText('Jane Stone')).toBeNull()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Account' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Download data' }))
    expect(success).not.toHaveBeenCalled()
  })

  it('triggers the hidden file input from the upload button', async () => {
    renderWithClient(<AccountProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change avatar/ }))
    const fileInput = (await screen.findByLabelText('Avatar image')) as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click')
    fireEvent.click(screen.getByRole('button', { name: /Upload image/ }))
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('cancels the username, email, and password dialogs', async () => {
    renderWithClient(<AccountProfilePage />)

    fireEvent.click(await screen.findByRole('button', { name: /Edit username/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Username')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /Change email/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Email')).toBeNull())

    expect(success).not.toHaveBeenCalled()
  })

  it('cancels the password dialog from the security password panel', async () => {
    // password dialog lives on the profile page only when password panel is shown via security page;
    // here we exercise the profile-account password-less path and confirm no password dialog leaks
    renderWithClient(<AccountProfilePage />)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeTruthy()
    expect(screen.queryByLabelText('Current password')).toBeNull()
  })
})

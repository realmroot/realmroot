import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSiteNavigation, replaceSiteNavigation } from '@/lib/api/management'
import { SiteNavigationSettings } from './site-navigation-settings'

vi.mock('@/lib/api/management', () => ({ getSiteNavigation: vi.fn(), replaceSiteNavigation: vi.fn() }))
const wallet = { id: 'wallet', label: 'Wallet', url: 'https://wallet.example.com', icon: 'wallet' as const }
function mount(links = [wallet]) {
  let revision = 1
  vi.mocked(getSiteNavigation).mockResolvedValue({ externalLinks: links, revision, etag: '"1"' })
  vi.mocked(replaceSiteNavigation).mockImplementation(async ({ input }) => ({
    ...input,
    revision: ++revision,
    etag: `"${revision}"`,
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SiteNavigationSettings />
    </QueryClientProvider>,
  )
  return client
}
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('site navigation settings', () => {
  it('adds, edits, reorders and deletes links through dialogs', async () => {
    mount([])
    expect(screen.getByRole('status')).toBeTruthy()
    expect(await screen.findByText('No external services configured.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add service' }))
    let dialog = within(screen.getByRole('dialog'))
    await userEvent.type(dialog.getByLabelText('Name'), 'Wallet')
    await userEvent.type(dialog.getByLabelText('URL'), wallet.url)
    await userEvent.selectOptions(dialog.getByLabelText('Icon'), 'wallet')
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Wallet')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add service' }))
    dialog = within(screen.getByRole('dialog'))
    await userEvent.type(dialog.getByLabelText('Name'), 'Docs')
    await userEvent.type(dialog.getByLabelText('URL'), 'https://docs.example.com')
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Move up: Docs' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')[0].textContent).toContain('Docs'))
    await userEvent.click(screen.getByRole('button', { name: 'Move down: Docs' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')[0].textContent).toContain('Wallet'))
    await userEvent.click(screen.getByRole('button', { name: 'Edit: Wallet' }))
    dialog = within(screen.getByRole('dialog'))
    await userEvent.clear(dialog.getByLabelText('Name'))
    await userEvent.type(dialog.getByLabelText('Name'), 'My Wallet')
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Delete: My Wallet' }))
    await waitFor(() => expect(screen.queryByText('My Wallet')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Delete: Docs' }))
    expect(await screen.findByText('No external services configured.')).toBeTruthy()
  })
  it('rejects an unsafe URL without saving and preserves an unsuccessful edit', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit: Wallet' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('URL'), { target: { value: 'http://unsafe.example.com' } })
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    expect(dialog.getByRole('alert').textContent).toContain('HTTPS')
    expect(replaceSiteNavigation).not.toHaveBeenCalled()
    fireEvent.change(dialog.getByLabelText('URL'), { target: { value: wallet.url } })
    vi.mocked(replaceSiteNavigation).mockRejectedValueOnce(new Error('Site navigation changed after it was read.'))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('changed')
    expect((dialog.getByLabelText('URL') as HTMLInputElement).value).toBe(wallet.url)
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('shows and reloads query errors, and surfaces failed list operations', async () => {
    mount()
    vi.mocked(getSiteNavigation).mockRejectedValueOnce(new Error('Configuration unavailable'))
    expect(await screen.findByText('Wallet')).toBeTruthy()
    vi.mocked(replaceSiteNavigation).mockRejectedValueOnce(new Error('Save unavailable'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete: Wallet' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Save unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(getSiteNavigation).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Wallet')).toBeTruthy()
  })
  it('closes an unused editor and limits the list size', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit: Wallet' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
    mount(Array.from({ length: 20 }, (_, index) => ({ ...wallet, id: `link-${index}` })))
    await screen.findAllByText('Wallet')
    expect((screen.getByRole('button', { name: 'Add service' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

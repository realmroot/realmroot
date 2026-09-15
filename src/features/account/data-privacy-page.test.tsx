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
import { AccountDataPrivacyPage } from './data-privacy-page'

const success = vi.fn()
const errorToast = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    params,
    to,
  }: {
    children: ReactNode
    className?: string
    params?: Record<string, string>
    to: string
  }) => (
    <a
      className={className}
      href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)}
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => errorToast(...a) },
}))

const store = createAccountStore()
const server = createAccountServer(store)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  success.mockClear()
  errorToast.mockClear()
  void i18n.changeLanguage('en')
  Object.assign(store, createAccountStore())
})
afterAll(() => server.close())

describe('AccountDataPrivacyPage', () => {
  it('downloads a machine-readable account snapshot [spec: account-center/account-data-export]', async () => {
    const createObjectURL = vi.fn(() => 'blob:account-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithClient(<AccountDataPrivacyPage />, { section: 'data-privacy' })
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
      http.get(`${base}/api/account/application-authorizations`, () => {
        protectedDataRequests += 1
        return HttpResponse.json({ items: [] })
      }),
      http.get(`${base}/api/account/linked-accounts`, () => {
        protectedDataRequests += 1
        return HttpResponse.json({ items: [], pagination: null })
      }),
      http.get(`${base}/api/account/sessions`, () => {
        protectedDataRequests += 1
        return HttpResponse.json({ items: [], pagination: null })
      }),
    )
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:limited-export') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithClient(<AccountDataPrivacyPage />, { section: 'data-privacy' })
    fireEvent.click(await screen.findByRole('button', { name: 'Download data' }))

    await waitFor(() => expect(success).toHaveBeenCalledWith('Account data downloaded.'))
    expect(protectedDataRequests).toBe(0)
  })

  it('renders Data & privacy copy in Simplified Chinese', async () => {
    await i18n.changeLanguage('zh')

    renderWithClient(<AccountDataPrivacyPage />, { section: 'data-privacy' })

    expect(await screen.findByRole('heading', { name: '数据与隐私' })).toBeTruthy()
    expect(screen.getByText('导出你的账户数据并管理永久删除。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '数据与隐私' }).className).toContain('is-active')
    expect(screen.getByText('导出账户数据')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载数据' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除账户' })).toBeTruthy()
  })
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreferencesControls } from '@/components/preferences-controls'
import { i18n, normalizeLanguage } from '@/lib/i18n'
import { ThemeProvider, useTheme } from '@/lib/theme'

afterEach(async () => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
  await i18n.changeLanguage('en')
})

describe('PreferencesControls', () => {
  it('updates language and theme preferences from the shared controls', async () => {
    render(
      <ThemeProvider>
        <PreferencesControls />
      </ThemeProvider>,
    )

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh' } })

    await waitFor(() => expect(i18n.language).toBe('zh'))
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(window.localStorage.getItem('flareauth.language')).toBe('zh')
    expect(document.cookie).toContain('flareauth_locale=zh')

    fireEvent.change(screen.getByLabelText('主题'), { target: { value: 'dark' } })

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('flareauth.theme')).toBe('dark')
  })

  it('normalizes unsupported preferences back to the default options', async () => {
    await i18n.changeLanguage('zh-CN')

    render(
      <ThemeProvider>
        <PreferencesControls />
      </ThemeProvider>,
    )

    expect((screen.getByLabelText('语言') as unknown as HTMLSelectElement).value).toBe('zh')

    fireEvent.change(screen.getByLabelText('主题'), { target: { value: 'system' } })
    fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'fr' } })

    await waitFor(() => expect(i18n.language).toBe('en'))
    expect(window.localStorage.getItem('flareauth.theme')).toBe('light')
  })
})

describe('theme preference fallback', () => {
  it('applies stored theme through ThemeProvider', async () => {
    window.localStorage.setItem('flareauth.theme', 'dark')

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getByText('dark')).toBeTruthy()
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('uses the system color scheme when no theme is stored', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
      }),
    )

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getByText('dark')).toBeTruthy()
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    vi.unstubAllGlobals()
  })

  it('applies theme updates when useTheme is used without a provider', async () => {
    render(<ThemeProbe />)

    expect(screen.getByText('light')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Use dark' }))

    await waitFor(() => expect(screen.getByText('dark')).toBeTruthy())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('flareauth.theme')).toBe('dark')
  })
})

describe('i18n preferences', () => {
  it('normalizes locale variants to supported languages', () => {
    expect(normalizeLanguage('zh-Hans-CN')).toBe('zh')
    expect(normalizeLanguage('zh')).toBe('zh')
    expect(normalizeLanguage('en-US')).toBe('en')
    expect(normalizeLanguage(undefined)).toBe('en')
  })
})

function ThemeProbe() {
  const { setTheme, theme } = useTheme()

  return (
    <div>
      <span>{theme}</span>
      <button onClick={() => setTheme('dark')} type="button">
        Use dark
      </button>
    </div>
  )
}

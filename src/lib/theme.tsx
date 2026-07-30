import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'

export type Theme = 'light' | 'dark'

type ThemeContextValue = {
  setTheme: (theme: Theme) => void
  theme: Theme
}

const themeStorageKey = 'realmroot.theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const value = useMemo(() => ({ setTheme, theme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  const [fallbackTheme, setFallbackTheme] = useState<Theme>(() => readStoredTheme())

  useEffect(() => {
    if (context) return
    applyTheme(fallbackTheme)
  }, [context, fallbackTheme])

  return context ?? { setTheme: setFallbackTheme, theme: fallbackTheme }
}

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(themeStorageKey)
  if (stored === 'dark' || stored === 'light') return stored
  if (!window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.dataset.theme = theme
  window.localStorage.setItem(themeStorageKey, theme)
}

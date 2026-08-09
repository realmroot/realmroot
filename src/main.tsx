import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { i18n } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'
import { AppRouter } from './router'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root is missing.')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <I18nRenderBoundary />
    </ThemeProvider>
  </StrictMode>,
)

function I18nRenderBoundary() {
  const [language, setLanguage] = useState(i18n.language)

  useEffect(() => {
    i18n.on('languageChanged', setLanguage)
    return () => i18n.off('languageChanged', setLanguage)
  }, [])

  return <AppRouter language={language} />
}

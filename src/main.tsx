import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ApplicationErrorBoundary } from '@/components/application-error-boundary'
import { i18n } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'
import { AppRouter } from './router'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root is missing.')

createRoot(root).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <ThemeProvider>
        <I18nRenderBoundary />
      </ThemeProvider>
    </ApplicationErrorBoundary>
  </StrictMode>,
)

function I18nRenderBoundary() {
  const [language, setLanguage] = useState(i18n.language)

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('realmroot:ready', { detail: i18n.language }))
    i18n.on('languageChanged', setLanguage)
    return () => i18n.off('languageChanged', setLanguage)
  }, [])

  return <AppRouter language={language} />
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountRoute } from './routes/account'
import { App } from './routes/app'
import { AuthCallbackRoute } from './routes/auth-callback'
import { EmailVerificationRoute } from './routes/email-verification'
import { ForgotPasswordRoute } from './routes/forgot-password'
import { OAuthConsentRoute } from './routes/oauth/consent'
import { SignInRoute } from './routes/sign-in'
import { SignUpRoute } from './routes/sign-up'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root is missing.')

function Router() {
  const path = window.location.pathname
  if (path === '/sign-in') return <SignInRoute />
  if (path === '/sign-up') return <SignUpRoute />
  if (path === '/forgot-password') return <ForgotPasswordRoute />
  if (path === '/email-verification') return <EmailVerificationRoute />
  if (path === '/auth/callback') return <AuthCallbackRoute />
  if (path === '/oauth/consent') return <OAuthConsentRoute />
  if (path.startsWith('/account')) return <AccountRoute />
  return <App />
}

createRoot(root).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)

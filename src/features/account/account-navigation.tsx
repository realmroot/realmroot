import { Link } from '@tanstack/react-router'
import { tt } from '@/lib/i18n'

export function AccountSettingsNavigation({ section }: { section: 'profile' | 'security' }) {
  return (
    <nav className="accountRouteTabs" aria-label={tt('Account settings')}>
      <Link to="/profile" aria-current={section === 'profile' ? 'page' : undefined}>
        {tt('Personal profile')}
      </Link>
      <Link to="/security" aria-current={section === 'security' ? 'page' : undefined}>
        {tt('Sign-in & security')}
      </Link>
    </nav>
  )
}

export function AccountAccessNavigation({ section }: { section: 'applications' | 'connections' }) {
  return (
    <nav className="accountRouteTabs" aria-label={tt('Access management')}>
      <Link to="/applications" aria-current={section === 'applications' ? 'page' : undefined}>
        {tt('Authorized applications')}
      </Link>
      <Link to="/connections" aria-current={section === 'connections' ? 'page' : undefined}>
        {tt('Connections')}
      </Link>
    </nav>
  )
}

import { createFileRoute, Link } from '@tanstack/react-router'
import { tt } from '@/lib/i18n'

export const Route = createFileRoute('/auth/account-deleted')({ component: AccountDeletedPage })

function AccountDeletedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1 className="text-2xl font-semibold">{tt('Your account has been deleted')}</h1>
      <p className="mt-4">
        {tt(
          'Your Realmroot account cannot be restored. External credential revocation and file cleanup will continue automatically.',
        )}
      </p>
      <Link className="mt-6 inline-block underline" to="/auth/sign-in">
        {tt('Back to sign in')}
      </Link>
    </main>
  )
}

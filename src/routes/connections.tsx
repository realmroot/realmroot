import { createFileRoute } from '@tanstack/react-router'
import { AccountConnectionsPage } from '@/features/account/account-center'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/connections')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: AccountConnectionsPage,
})

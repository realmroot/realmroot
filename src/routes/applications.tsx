import { createFileRoute } from '@tanstack/react-router'
import { AccountApplicationsPage } from '@/features/account/account-center'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/applications')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: AccountApplicationsPage,
})

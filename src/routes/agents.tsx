import { createFileRoute } from '@tanstack/react-router'
import { AccountAgentsPage } from '@/features/account/account-center'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/agents')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: AccountAgentsPage,
})

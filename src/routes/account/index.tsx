import { createFileRoute } from '@tanstack/react-router'
import { AccountOverviewPage } from '@/features/account/account-center'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/account/')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: AccountOverviewPage,
})

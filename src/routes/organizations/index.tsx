import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationsPage } from '@/features/account/account-center'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/organizations/')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: AccountOrganizationsPage,
})

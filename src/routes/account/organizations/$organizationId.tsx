import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/account/organizations/$organizationId')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: OrganizationDetailRoute,
})

function OrganizationDetailRoute() {
  const { organizationId } = Route.useParams()
  return <AccountOrganizationDetailPage organizationId={organizationId} />
}

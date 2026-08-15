import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { synchronizeActiveAccountOrganization } from '@/lib/route-auth'

export const Route = createFileRoute('/_account/organizations/$organizationId')({
  beforeLoad: async ({ context, location, params }) => {
    const detailPath = `/organizations/${params.organizationId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview` })
    }
    await synchronizeActiveAccountOrganization(context.queryClient, params.organizationId)
  },
  component: Outlet,
})

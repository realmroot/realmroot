import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/organizations/$organizationId')({
  beforeLoad: async ({ location, params }) => {
    await requireAccountProfile(location.href)
    const detailPath = `/organizations/${params.organizationId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview` })
    }
  },
  component: Outlet,
})

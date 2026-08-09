import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_account/organizations/$organizationId/resource-servers/$resourceId')({
  beforeLoad: ({ location, params }) => {
    const base = `/organizations/${params.organizationId}/resource-servers/${params.resourceId}`
    if (location.pathname === base || location.pathname === `${base}/`) {
      throw redirect({ href: `${base}/overview` })
    }
  },
  component: Outlet,
})

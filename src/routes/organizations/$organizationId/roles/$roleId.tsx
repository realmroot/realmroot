import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/organizations/$organizationId/roles/$roleId')({
  beforeLoad: ({ location, params }) => {
    const base = `/organizations/${params.organizationId}/roles/${params.roleId}`
    if (location.pathname === base || location.pathname === `${base}/`) {
      throw redirect({ href: `${base}/overview` })
    }
  },
  component: Outlet,
})

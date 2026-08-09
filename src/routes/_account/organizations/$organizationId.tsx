import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_account/organizations/$organizationId')({
  beforeLoad: ({ location, params }) => {
    const detailPath = `/organizations/${params.organizationId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview` })
    }
  },
  component: Outlet,
})

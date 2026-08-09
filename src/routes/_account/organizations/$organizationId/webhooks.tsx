import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_account/organizations/$organizationId/webhooks')({
  beforeLoad: ({ location, params }) => {
    const base = `/organizations/${params.organizationId}/webhooks`
    if (location.pathname === base || location.pathname === `${base}/`) {
      throw redirect({ href: `${base}/endpoints` })
    }
  },
  component: Outlet,
})

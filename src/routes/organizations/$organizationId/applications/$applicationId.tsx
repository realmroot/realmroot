import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/organizations/$organizationId/applications/$applicationId')({
  beforeLoad: ({ location, params }) => {
    const base = `/organizations/${params.organizationId}/applications/${params.applicationId}`
    if (location.pathname === base || location.pathname === `${base}/`) {
      throw redirect({ href: `${base}/overview` })
    }
  },
  component: Outlet,
})

import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/organizations/$organizationId/agents/$agentId')({
  beforeLoad: ({ location, params }) => {
    const base = `/organizations/${params.organizationId}/agents/${params.agentId}`
    if (location.pathname === base || location.pathname === `${base}/`) {
      throw redirect({ href: `${base}/overview` })
    }
  },
  component: Outlet,
})

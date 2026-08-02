import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/agents/$agentId')({
  beforeLoad: ({ location, params }) => {
    const detailPath = `/console/agents/${params.agentId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview${location.searchStr}` })
    }
  },
})

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/organizations/$organizationId')({
  beforeLoad: ({ location, params }) => {
    const detailPath = `/console/organizations/${params.organizationId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview${location.searchStr}` })
    }
  },
})

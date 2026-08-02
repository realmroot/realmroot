import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/applications/$applicationId')({
  beforeLoad: ({ location, params }) => {
    const detailPath = `/console/applications/${params.applicationId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview${location.searchStr}` })
    }
  },
})

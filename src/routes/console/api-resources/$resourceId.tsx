import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/api-resources/$resourceId')({
  beforeLoad: ({ location, params }) => {
    const detailPath = `/console/api-resources/${params.resourceId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview${location.searchStr}` })
    }
  },
})

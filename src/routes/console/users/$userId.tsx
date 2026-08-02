import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/users/$userId')({
  beforeLoad: ({ location, params }) => {
    const detailPath = `/console/users/${params.userId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview${location.searchStr}` })
    }
  },
})

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/roles/$roleId')({
  beforeLoad: ({ location, params }) => {
    const detailPath = `/console/roles/${params.roleId}`
    if (location.pathname === detailPath || location.pathname === `${detailPath}/`) {
      throw redirect({ href: `${detailPath}/overview${location.searchStr}` })
    }
  },
})

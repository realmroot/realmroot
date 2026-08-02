import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/roles/$roleId/activity')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/roles/${params.roleId}/overview` })
  },
})

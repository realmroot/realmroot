import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/roles/$roleId/scopes')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/roles/${params.roleId}/permissions` })
  },
})

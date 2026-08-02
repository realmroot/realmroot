import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/organizations/$organizationId/authorization')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/organizations/${params.organizationId}/overview` })
  },
})

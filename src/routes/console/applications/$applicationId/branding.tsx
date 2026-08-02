import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/applications/$applicationId/branding')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/applications/${params.applicationId}/settings` })
  },
})

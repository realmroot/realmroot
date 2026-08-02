import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/applications/$applicationId/federated-credentials')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/applications/${params.applicationId}/oauth` })
  },
})

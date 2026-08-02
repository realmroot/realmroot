import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/organization-template/')({
  beforeLoad: () => {
    throw redirect({ href: '/console/roles' })
  },
})

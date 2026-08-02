import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/organization-template/organization-roles')({
  beforeLoad: () => {
    throw redirect({ href: '/console/roles' })
  },
})

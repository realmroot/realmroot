import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/customize-jwt')({
  beforeLoad: () => {
    throw redirect({ href: '/console/applications' })
  },
})

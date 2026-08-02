import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/mfa')({
  beforeLoad: () => {
    throw redirect({ href: '/console/security/mfa' })
  },
})

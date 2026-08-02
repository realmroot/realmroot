import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/security/blocklist')({
  beforeLoad: () => {
    throw redirect({ href: '/console/security/abuse' })
  },
})

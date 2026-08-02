import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/security/')({
  beforeLoad: () => {
    throw redirect({ href: '/console/security/sign-in' })
  },
})

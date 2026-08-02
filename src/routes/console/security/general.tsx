import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/security/general')({
  beforeLoad: () => {
    throw redirect({ href: '/console/security/sign-in' })
  },
})

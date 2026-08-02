import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/sign-in-experience/account-center')({
  beforeLoad: () => {
    throw redirect({ href: '/console/sign-in-experience/theme' })
  },
})

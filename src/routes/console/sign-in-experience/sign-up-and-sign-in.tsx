import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/sign-in-experience/sign-up-and-sign-in')({
  beforeLoad: () => {
    throw redirect({ href: '/console/sign-in-experience/sign-in' })
  },
})

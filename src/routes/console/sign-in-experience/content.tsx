import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/sign-in-experience/content')({
  beforeLoad: () => {
    throw redirect({ href: '/console/sign-in-experience/legal' })
  },
})

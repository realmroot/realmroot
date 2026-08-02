import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/security/captcha')({
  beforeLoad: () => {
    throw redirect({ href: '/console/security/abuse' })
  },
})

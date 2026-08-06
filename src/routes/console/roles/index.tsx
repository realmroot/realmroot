import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/roles/')({
  beforeLoad: () => {
    throw redirect({ href: '/organizations' })
  },
})

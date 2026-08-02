import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/tenant-settings/')({
  beforeLoad: () => {
    throw redirect({ href: '/console/tenant-settings/general' })
  },
})

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/tenant-settings/oidc-configs')({
  beforeLoad: () => {
    throw redirect({ href: '/console/tenant-settings/deployment' })
  },
})

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/organizations/$organizationId')({
  beforeLoad: ({ location, params }) => {
    const section = location.pathname.split('/').filter(Boolean).at(-1)
    const target = ['overview', 'members', 'agents', 'activity', 'settings'].includes(section ?? '')
      ? section
      : 'overview'
    throw redirect({ href: `/organizations/${params.organizationId}/${target}` })
  },
})

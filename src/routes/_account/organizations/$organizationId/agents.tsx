import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_account/organizations/$organizationId/agents')({
  component: Outlet,
})

import { createFileRoute } from '@tanstack/react-router'
import { RoleAssignmentsPage } from '@/features/console/pages/role-assignments-page'

export const Route = createFileRoute('/console/role-assignments')({
  component: RoleAssignmentsPage,
})

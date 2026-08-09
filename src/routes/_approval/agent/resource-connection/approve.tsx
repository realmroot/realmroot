import { createFileRoute } from '@tanstack/react-router'
import { ResourceConnectionApprovalPage } from '@/features/agents/resource-connection-approval'

export const Route = createFileRoute('/_approval/agent/resource-connection/approve')({
  component: ResourceConnectionApprovalPage,
})

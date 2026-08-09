import { createFileRoute } from '@tanstack/react-router'
import { ResourceAccessApproval } from '@/features/agents/resource-access-approval'

export const Route = createFileRoute('/_approval/agent/resource-access/approve')({ component: ResourceAccessApproval })

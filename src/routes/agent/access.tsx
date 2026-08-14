import { createFileRoute } from '@tanstack/react-router'
import { ResourceAccessApproval } from '@/features/agents/resource-access-approval'

export const Route = createFileRoute('/agent/access')({ component: ResourceAccessApproval })

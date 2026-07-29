import { createFileRoute } from '@tanstack/react-router'
import { ResourceAccessApproval } from '@/features/agents/resource-access-approval'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/agent/resource-access/approve')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: ResourceAccessApproval,
})

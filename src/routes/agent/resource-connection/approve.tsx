import { createFileRoute } from '@tanstack/react-router'
import { ResourceConnectionApprovalPage } from '@/features/agents/resource-connection-approval'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/agent/resource-connection/approve')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: ResourceConnectionApprovalPage,
})

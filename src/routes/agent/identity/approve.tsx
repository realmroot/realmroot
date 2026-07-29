import { createFileRoute } from '@tanstack/react-router'
import { AgentIdentityApproval } from '@/features/agents/agent-identity-approval'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/agent/identity/approve')({
  beforeLoad: async ({ location }) => {
    await requireAccountProfile(location.href)
  },
  component: AgentIdentityApproval,
})

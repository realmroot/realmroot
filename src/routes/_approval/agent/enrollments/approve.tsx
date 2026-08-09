import { createFileRoute } from '@tanstack/react-router'
import { AgentIdentityApproval } from '@/features/agents/agent-identity-approval'

export const Route = createFileRoute('/_approval/agent/enrollments/approve')({ component: AgentIdentityApproval })

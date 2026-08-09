import { createFileRoute } from '@tanstack/react-router'
import { AgentApproval } from '@/features/agents/agent-approval'

export const Route = createFileRoute('/_approval/agent/approve')({ component: AgentApproval })

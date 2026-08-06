import { createFileRoute } from '@tanstack/react-router'
import { AgentsPage } from '@/features/agents/management-agents-page'

export const Route = createFileRoute('/console/agents/')({
  component: AgentsPage,
})

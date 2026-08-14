import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/agent')({
  beforeLoad: async ({ context, location }) => {
    await requireAccountProfile(location.href, context.queryClient)
  },
  component: AgentRouteBoundary,
})

function AgentRouteBoundary() {
  return <Outlet />
}

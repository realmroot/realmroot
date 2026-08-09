import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { ConsoleShell } from '@/components/layout/console-shell'
import { loadCachedDeveloperConsoleAccess, requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/console')({
  beforeLoad: async ({ context, location }) => {
    const profile = await requireAccountProfile(location.href, context.queryClient)
    const access = await loadCachedDeveloperConsoleAccess(context.queryClient)
    if (!access.platformOperator) throw redirect({ href: '/organizations' })
    return { consoleProfile: profile.user }
  },
  component: ConsoleRoute,
})

function ConsoleRoute() {
  const { consoleProfile } = Route.useRouteContext()
  return (
    <ConsoleShell profile={consoleProfile}>
      <Outlet />
    </ConsoleShell>
  )
}

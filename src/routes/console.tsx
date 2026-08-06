import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { ConsoleShell } from '@/components/layout/console-shell'
import { loadDeveloperConsoleAccess, requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/console')({
  beforeLoad: async ({ location }) => {
    const [profile, access] = await Promise.all([requireAccountProfile(location.href), loadDeveloperConsoleAccess()])
    if (!access.realmOperator) throw redirect({ href: '/organizations' })
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

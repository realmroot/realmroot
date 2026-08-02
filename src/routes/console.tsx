import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { ConsoleShell } from '@/components/layout/console-shell'
import { listOrganizations } from '@/lib/api/management'
import { loadDeveloperConsoleAccess, requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/console')({
  validateSearch: (search: Record<string, unknown>): { context?: string } => {
    const context = typeof search.context === 'string' && search.context.length > 0 ? search.context : undefined
    return context ? { context } : {}
  },
  beforeLoad: async ({ location }) => {
    const [profile, access] = await Promise.all([requireAccountProfile(location.href), loadDeveloperConsoleAccess()])
    if (!access.realmOperator && access.consoleOrganizations.length === 0) throw redirect({ href: '/profile' })
    return { consoleAccess: access, consoleProfile: profile.user }
  },
  loader: listOrganizations,
  component: ConsoleRoute,
})

function ConsoleRoute() {
  const { consoleAccess, consoleProfile } = Route.useRouteContext()
  const organizations = Route.useLoaderData().organizations.filter(
    (organization) =>
      organization.id !== 'org_platform' &&
      (consoleAccess.realmOperator ||
        consoleAccess.consoleOrganizations.some((item) => item.organizationId === organization.id)),
  )
  return (
    <ConsoleShell access={consoleAccess} organizations={organizations} profile={consoleProfile}>
      <Outlet />
    </ConsoleShell>
  )
}

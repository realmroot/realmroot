import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { ConsoleShell } from '@/components/layout/console-shell'
import { listOrganizations } from '@/lib/api/management'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/console')({
  validateSearch: (search: Record<string, unknown>): { context?: string } => {
    const context = typeof search.context === 'string' && search.context.length > 0 ? search.context : undefined
    return context ? { context } : {}
  },
  beforeLoad: async ({ location }) => {
    const profile = await requireAccountProfile(location.href)
    if (!profile.access.realmOperator && profile.access.consoleOrganizations.length === 0)
      throw redirect({ href: '/profile' })
    return { consoleAccess: profile.access, consoleProfile: profile.user }
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

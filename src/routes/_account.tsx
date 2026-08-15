import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { AccountCenterLayout } from '@/features/account/account-center'
import { requireAccountProfile } from '@/lib/route-auth'

export const Route = createFileRoute('/_account')({
  beforeLoad: async ({ context, location }) => {
    await requireAccountProfile(location.href, context.queryClient)
  },
  component: AccountRoute,
})

function AccountRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const organizationId = organizationIdFromPathname(pathname)
  return (
    <AccountCenterLayout organizationId={organizationId} pathname={pathname} section={accountSection(pathname)}>
      <Outlet />
    </AccountCenterLayout>
  )
}

function organizationIdFromPathname(pathname: string) {
  const [, collection, organizationId] = pathname.split('/')
  return collection === 'organizations' && organizationId ? organizationId : undefined
}

function accountSection(pathname: string) {
  if (pathname.startsWith('/profile')) return 'profile' as const
  if (pathname.startsWith('/security')) return 'security' as const
  if (pathname.startsWith('/connections')) return 'connections' as const
  if (pathname.startsWith('/applications')) return 'applications' as const
  if (pathname.startsWith('/agents')) return 'agents' as const
  if (pathname.startsWith('/organizations')) return 'organizations' as const
  return 'overview' as const
}

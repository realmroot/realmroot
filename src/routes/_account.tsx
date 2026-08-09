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
  return (
    <AccountCenterLayout section={accountSection(pathname)}>
      <Outlet />
    </AccountCenterLayout>
  )
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

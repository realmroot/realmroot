import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

import { PageNotFound, RouteErrorPage } from '@/features/auth/error-page'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  errorComponent: RouteErrorPage,
  notFoundComponent: PageNotFound,
  component: () => <Outlet />,
})

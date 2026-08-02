import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { routeTree } from './routeTree.gen'

export const queryClient = new QueryClient()

export const router = createRouter({ routeTree })

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

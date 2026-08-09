import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryClient } from '@/lib/query-client'
import { routeTree } from './routeTree.gen'

export { queryClient } from '@/lib/query-client'

export const router = createRouter({ context: { queryClient }, routeTree })

export function AppRouter({ language }: { language?: string }) {
  void language
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

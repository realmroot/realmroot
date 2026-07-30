import { createFileRoute, redirect } from '@tanstack/react-router'
import { safeRedirectPath } from '@/features/auth/hooks'
import { takeAccountReturnTarget } from '@/lib/route-auth'

export const Route = createFileRoute('/auth/continue')({
  validateSearch: (search: Record<string, unknown>) => ({
    return_key: typeof search.return_key === 'string' ? search.return_key : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ href: safeRedirectPath(takeAccountReturnTarget(search.return_key)) ?? '/profile' })
  },
})

import { QueryClient } from '@tanstack/react-query'
import { ApiRequestError } from '@/lib/api'

export const queryClientDefaultOptions = {
  queries: {
    retry: (failureCount: number, error: unknown) => failureCount < 1 && isTransientQueryError(error),
    staleTime: 60_000,
  },
} as const

export const queryClient = new QueryClient({ defaultOptions: queryClientDefaultOptions })

function isTransientQueryError(error: unknown) {
  if (error instanceof TypeError) return /fetch|network|load failed/i.test(error.message)
  return error instanceof ApiRequestError && (error.status === 408 || error.status === 429 || error.status >= 500)
}

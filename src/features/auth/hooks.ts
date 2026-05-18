import type { ConfigzConfigResponse } from '@shared/api/configz'
import { useEffect, useState } from 'react'
import { getConfigz } from '@/lib/api'

type LoadState<T> = {
  data: T | null
  error: string | null
  loading: boolean
}

export function useConfigz(): LoadState<ConfigzConfigResponse> {
  const [state, setState] = useState<LoadState<ConfigzConfigResponse>>({
    data: null,
    error: null,
    loading: true,
  })

  useEffect(() => {
    let active = true

    getConfigz()
      .then((data) => {
        if (active) setState({ data, error: null, loading: false })
      })
      .catch((error: unknown) => {
        if (active)
          setState({ data: null, error: error instanceof Error ? error.message : 'Unable to load.', loading: false })
      })

    return () => {
      active = false
    }
  }, [])

  return state
}

export function callbackURL() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('client_id') && params.has('redirect_uri')) {
    return `/api/auth/oauth2/authorize${window.location.search}`
  }
  return safeRedirectPath(params.get('callbackURL')) ?? safeRedirectPath(params.get('return_to')) ?? undefined
}

export function safeRedirectPath(value: string | null | undefined): string | undefined {
  if (!value?.startsWith('/') || value.startsWith('//')) return undefined
  if (value.startsWith('/api/') && !value.startsWith('/api/auth/oauth2/authorize')) return undefined
  return value
}

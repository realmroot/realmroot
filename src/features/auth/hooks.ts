import type { ExperienceConfigResponse } from '@shared/api/experience'
import { useEffect, useState } from 'react'
import { getExperienceConfig } from '@/lib/api'

type LoadState<T> = {
  data: T | null
  error: string | null
  loading: boolean
}

export function useExperienceConfig(): LoadState<ExperienceConfigResponse> {
  const [state, setState] = useState<LoadState<ExperienceConfigResponse>>({
    data: null,
    error: null,
    loading: true,
  })

  useEffect(() => {
    let active = true

    getExperienceConfig()
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
  return params.get('callbackURL') ?? params.get('return_to') ?? undefined
}

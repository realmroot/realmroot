import type { AccountProfileResponse, AccountSecurityResponse } from '@shared/api/account'
import { redirect } from '@tanstack/react-router'
import { apiClient } from '@/lib/api'

const returnTargetPrefix = 'realmroot:return-target:'

export type RouteAccountProfile = AccountProfileResponse

export async function loadAccountProfile() {
  const response = await apiClient.api.account.profile.$get()
  if (response.status === 401) return null
  if (!response.ok) throw new Error(await readErrorMessage(response))
  return (await response.json()) as RouteAccountProfile
}

export async function requireAccountProfile(locationHref: string) {
  const profile = await loadAccountProfile()
  if (!profile) {
    const fragmentIndex = locationHref.indexOf('#')
    if (fragmentIndex >= 0) {
      const returnKey = crypto.randomUUID()
      sessionStorage.setItem(`${returnTargetPrefix}${returnKey}`, locationHref)
      throw redirect({ href: `/auth/sign-in?return_key=${encodeURIComponent(returnKey)}` })
    }
    throw redirect({ href: `/auth/sign-in?return_to=${encodeURIComponent(locationHref)}` })
  }
  if (new URL(locationHref, 'http://realmroot.local').pathname !== '/security') {
    const security = await loadAccountSecurity()
    if (security.policy.mfa.mode === 'required' && !security.mfa.enabled) throw redirect({ href: '/security' })
  }
  return profile
}

async function loadAccountSecurity() {
  const response = await apiClient.api.account.security.$get()
  if (!response.ok) throw new Error(await readErrorMessage(response))
  return ((await response.json()) as AccountSecurityResponse).security
}

export function takeAccountReturnTarget(returnKey: string | undefined) {
  if (!returnKey) return undefined
  const storageKey = `${returnTargetPrefix}${returnKey}`
  const target = sessionStorage.getItem(storageKey) ?? undefined
  sessionStorage.removeItem(storageKey)
  return target
}

async function readErrorMessage(response: Pick<Response, 'statusText' | 'text'>) {
  const text = await response.text()
  if (!text) return response.statusText
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string } }
    if (typeof body.error === 'string') return body.error
    if (body.error?.message) return body.error.message
  } catch {
    return text
  }
  return text
}

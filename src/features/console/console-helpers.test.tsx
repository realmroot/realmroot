import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientConfig, clientTypeLabel, listItems, listValue } from '@/features/console/helpers/helpers-dialogs'
import { hostedAuthMode, passwordSignupEnabled, previewSignInAction } from '@/features/console/helpers/helpers-preview'
import {
  apiResourceDetailTabs,
  navigateConsoleTab,
  organizationDetailTabs,
  roleDetailTabs,
  userDetailTabs,
} from '@/features/console/helpers/helpers-resource'
import {
  connectorFieldLabel,
  connectorToForm,
  connectorUpdateForm,
  customCssProperties,
  formatDate,
  formatRole,
  nullableFormValue,
  nullableString,
  parseConnectorMetadata,
  parseCustomData,
  parseLineList,
  parseMetadata,
  parseTokenClaims,
  removeBlankValues,
  shallowEqual,
  userDisplayName,
} from '@/features/console/helpers/helpers-utils'
import { dashboardChartLabels, formatDashboardDate } from '@/features/console/pages/dashboard-page'
import { queryClient } from '@/router'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

import { application, connector, user } from './console.test-utils'

describe('admin console helpers', () => {
  it('normalizes admin console pure helpers', () => {
    expect(hostedAuthMode({ passwordEnabled: true } as Parameters<typeof hostedAuthMode>[0])).toBe('password')
    expect(
      hostedAuthMode({ passwordEnabled: false, emailOtpEnabled: true } as Parameters<typeof hostedAuthMode>[0]),
    ).toBe('otp')
    expect(
      hostedAuthMode({ passwordEnabled: false, emailOtpEnabled: false } as Parameters<typeof hostedAuthMode>[0]),
    ).toBeNull()
    expect(
      passwordSignupEnabled({ signupEnabled: true, passwordEnabled: true } as Parameters<
        typeof passwordSignupEnabled
      >[0]),
    ).toBe(true)
    expect(
      passwordSignupEnabled({ signupEnabled: true, passwordEnabled: false } as Parameters<
        typeof passwordSignupEnabled
      >[0]),
    ).toBe(false)
    expect(previewSignInAction('otp')).toBe('Send code')
    expect(previewSignInAction('password')).toBe('Sign in')
    const navigate = vi.fn()
    window.history.pushState(null, '', '/console/users/user-1')
    navigateConsoleTab(navigate, '/console/users/user-1/security')
    expect(navigate).toHaveBeenCalledWith({ to: '/console/users/user-1/security' })
    window.history.pushState(null, '', '/profile')
    navigateConsoleTab(navigate, '/console/users/user-1/security')
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(userDetailTabs().map((tab) => tab.value)).toContain('linked-accounts')
    expect(organizationDetailTabs().map((tab) => tab.value)).toEqual(['settings', 'authorization'])
    expect(roleDetailTabs().map((tab) => tab.value)).toContain('permissions')
    expect(apiResourceDetailTabs().map((tab) => tab.value)).toContain('scopes')
    expect(formatDashboardDate(new Date('2026-05-01T12:00:00.000Z'))).toBe('2026-05-01')
    expect(dashboardChartLabels(new Date('2026-05-29T00:00:00.000Z'))).toHaveLength(8)
    expect(listItems(['a', 'b'])).toEqual(['a', 'b'])
    expect(listItems(undefined)).toEqual([])
    expect(listValue(['openid', 'email'], ' ')).toBe('openid email')
    expect(clientTypeLabel('public_spa')).toBe('Public SPA')
    expect(clientTypeLabel('public_native')).toBe('Public native')
    expect(clientTypeLabel('confidential_web')).toBe('Confidential web')
    expect(removeBlankValues({ a: '', b: 'value' })).toEqual({ b: 'value' })
    expect(removeBlankValues(null)).toBeNull()
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(nullableString(' value ')).toBe('value')
    expect(nullableString('   ')).toBeNull()
    expect(parseTokenClaims('')).toBeUndefined()
    expect(parseTokenClaims('{"role":"admin"}')).toEqual({ role: 'admin' })
    expect(parseLineList(' a\n\n b ')).toEqual(['a', 'b'])
    expect(parseCustomData('')).toEqual({})
    expect(parseCustomData('{"tier":"pro"}')).toEqual({ tier: 'pro' })
    expect(() => parseCustomData('[]')).toThrow('Custom data JSON must be an object.')
    expect(customCssProperties(':root { color: red; }')).toEqual({})
    expect(customCssProperties('--auth-primary: #111; --auth-background: #fff;')).toEqual({
      '--auth-primary': '#111',
      '--auth-background': '#fff',
    })
    expect(formatDate(undefined)).toBe('Unknown')
    expect(formatRole(['admin', 'owner'])).toBe('admin, owner')
    expect(formatRole(null)).toBe('user')
    expect(userDisplayName({ ...user, displayName: 'Jane' })).toBe('Jane')
    expect(
      userDisplayName({ ...user, displayName: undefined, name: 'Jane Stone' } as Parameters<typeof userDisplayName>[0]),
    ).toBe('Jane Stone')
    expect(
      userDisplayName({ ...user, displayName: undefined, name: undefined } as Parameters<typeof userDisplayName>[0]),
    ).toBe(user.email)
    const config = JSON.parse(clientConfig(application as Parameters<typeof clientConfig>[0], 'secret')) as {
      clientSecret?: string
      redirectUris: string[]
    }
    expect(config.clientSecret).toBe('secret')
    expect(config.redirectUris).toEqual(application.redirectUris)
    expect(JSON.parse(clientConfig(application as Parameters<typeof clientConfig>[0], null))).not.toHaveProperty(
      'clientSecret',
    )
  })

  it('normalizes connector form helper values', () => {
    expect(parseMetadata(undefined)).toBeUndefined()
    expect(parseMetadata('   ')).toBeUndefined()
    expect(parseMetadata('{"prompt":"consent"}')).toEqual({ prompt: 'consent' })
    expect(() => parseMetadata('[]')).toThrow('Provider metadata must be a JSON object.')
    expect(() => parseMetadata('null')).toThrow('Provider metadata must be a JSON object.')

    expect(
      parseConnectorMetadata({
        providerMetadata: '{"scope":"openid"}',
        'metadata.allowUsersWithoutEmail': 'true',
        'metadata.empty': '',
        'metadata.prompt': 'select_account',
      } as Parameters<typeof parseConnectorMetadata>[0]),
    ).toEqual({
      scope: 'openid',
      allowUsersWithoutEmail: true,
      prompt: 'select_account',
    })
    expect(
      parseConnectorMetadata({ providerMetadata: '' } as Parameters<typeof parseConnectorMetadata>[0]),
    ).toBeUndefined()
    expect(connectorFieldLabel('clientIDRedirectURI')).toBe('Client ID Redirect URI')
    expect(nullableFormValue('')).toBeNull()
    expect(nullableFormValue('value')).toBe('value')
    expect(
      connectorUpdateForm({
        clientId: '',
        clientSecret: '  secret  ',
        issuer: '',
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: '',
        userInfoEndpoint: '',
        jwksEndpoint: '',
      } as Parameters<typeof connectorUpdateForm>[0]),
    ).toEqual(
      expect.objectContaining({
        clientId: null,
        clientSecret: 'secret',
        issuer: null,
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: null,
      }),
    )
    expect(
      (
        connectorUpdateForm({
          clientId: 'client-1',
          clientSecret: '   ',
          issuer: 'https://issuer.example.com',
          authorizationEndpoint: '',
          tokenEndpoint: '',
          userInfoEndpoint: '',
          jwksEndpoint: '',
        } as Parameters<typeof connectorUpdateForm>[0]) as { clientSecret: string }
      ).clientSecret,
    ).toBe('   ')
    expect(connectorToForm(null).slug).toBeUndefined()
    expect(connectorToForm(connector as Parameters<typeof connectorToForm>[0]).slug).toBe(connector.slug)
    expect(
      connectorToForm({
        ...connector,
        providerMetadata: { allowUsersWithoutEmail: true },
      } as Parameters<typeof connectorToForm>[0]).providerMetadata,
    ).toBe('{\n  "allowUsersWithoutEmail": true\n}')
  })
})

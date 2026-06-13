import type { ConnectorResponse, ConnectorTemplate } from '@shared/api/connectors'
import type { ManagementSignInSettingsResponse } from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ProviderRuntime } from '@/features/console/extracted/connectors/builtin-provider-controls'
import { BuiltinProviderPanel } from '@/features/console/extracted/connectors/builtin-provider-panel'
import { connectorProviderRows } from '@/features/console/extracted/connectors/provider-rows'
import { ConnectorDynamicFields, connectorCallbackUrl } from '@/features/console/extracted/connectors/social-fields'
import { connector, connectorTemplates, securityPolicy, signInSettings } from './console.test-utils'

const templates = connectorTemplates.templates as ConnectorTemplate[]

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(cleanup)

describe('connector provider rows', () => {
  it('reflects built-in runtime state and clientSecret configuration', () => {
    const rows = connectorProviderRows(
      templates,
      [{ ...connector, providerId: 'google', enabled: true, clientSecretConfigured: true } as ConnectorResponse],
      {
        ...signInSettings,
        builtInProviders: {
          ...signInSettings.builtInProviders,
          email: { ...signInSettings.builtInProviders.email, enabled: false },
          phone: { ...signInSettings.builtInProviders.phone, enabled: true },
          web3Wallet: { ...signInSettings.builtInProviders.web3Wallet, enabled: true },
          oneTap: { ...signInSettings.builtInProviders.oneTap, enabled: true },
        },
      } as ManagementSignInSettingsResponse,
      securityPolicy.policy as SecurityPolicy,
    )
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
    expect(byKey['builtin:email'].configurationLabel).toBe('Runtime disabled')
    expect(byKey['builtin:phone'].enabled).toBe(true)
    expect(byKey['builtin:web3-wallet'].enabled).toBe(true)
    expect(byKey['builtin:onetap'].enabled).toBe(true)
    expect(byKey['builtin:passkey'].configurationLabel).toBe('Runtime enabled')
    expect(byKey['social:google'].configurationLabel).toBe('Credentials configured')
    expect(byKey['social:google'].enabled).toBe(true)
  })

  it('falls back to disabled labels and credentials-required when settings are missing', () => {
    const rows = connectorProviderRows(templates, [], undefined, undefined)
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
    expect(byKey['builtin:email'].configurationLabel).toBe('Runtime disabled')
    expect(byKey['builtin:passkey'].configurationLabel).toBe('Runtime disabled')
    expect(byKey['social:google'].configurationLabel).toBe('Credentials required')
    expect(byKey['social:google'].enabled).toBe(false)
  })
})

describe('ProviderRuntime fallback panel', () => {
  it.each([
    ['phone', 'SMS runtime', 'SMS provider is not configured in this runtime.'],
    ['web3-wallet', 'Web3 wallet runtime', 'Wallet sign-in is not configured in this runtime.'],
    ['passkey', 'Passkey runtime', 'Passkey sign-in is managed by Multi-Factor Auth and is not enabled here.'],
    ['onetap', 'OneTap runtime', 'OneTap sign-in is not configured in this runtime.'],
    ['mystery', 'Provider runtime', 'This provider is not configured in this runtime.'],
  ])('renders runtime copy for %s', (providerId, title, description) => {
    render(<ProviderRuntime providerId={providerId} />)
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getByText(description)).toBeTruthy()
    cleanup()
  })
})

describe('ConnectorDynamicFields', () => {
  it('returns null when there is no template', () => {
    const { container } = render(
      <ConnectorDynamicFields form={{}} isExisting={false} setForm={() => {}} template={null} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders required and optional product fields with the right help text', () => {
    const template = {
      providerType: 'social' as const,
      providerId: 'custom',
      displayName: 'Custom',
      icon: 'custom',
      requiredFields: ['clientId', 'clientSecret'],
      optionalFields: ['providerMetadata.domain'],
      defaultScopes: ['openid'],
      endpoints: {
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
      },
    }
    render(
      <ConnectorDynamicFields form={{ clientId: 'id' }} isExisting={false} setForm={() => {}} template={template} />,
    )
    expect(screen.getAllByText('Required by this Better Auth provider.', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText('Optional provider parameter.', { exact: false })).toBeTruthy()
  })

  it('hints to leave the secret blank for an existing connector', () => {
    const template = {
      providerType: 'social' as const,
      providerId: 'custom',
      displayName: 'Custom',
      icon: 'custom',
      requiredFields: ['clientId', 'clientSecret'],
      optionalFields: [],
      defaultScopes: [],
      endpoints: {
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
      },
    }
    render(<ConnectorDynamicFields form={{}} isExisting={true} setForm={() => {}} template={template} />)
    expect(screen.getByText('Leave blank to keep the current secret.', { exact: false })).toBeTruthy()
  })
})

describe('connectorCallbackUrl', () => {
  it('builds a callback url from the window origin', () => {
    expect(connectorCallbackUrl('github')).toBe('http://localhost:3000/api/auth/callback/github')
  })
})

describe('BuiltinProviderPanel with absent settings', () => {
  const noop = () => {}
  const baseProps = {
    builtInProviders: null,
    error: 'render error' as string | null,
    onUpdatePasskey: noop,
    onUpdateSignIn: noop,
    pending: false,
    security: null,
  }

  function renderPanel(providerId: string) {
    return render(
      <Sheet open>
        <SheetContent>
          <BuiltinProviderPanel {...baseProps} provider={{ providerId }} />
        </SheetContent>
      </Sheet>,
    )
  }

  it.each([
    'email',
    'phone',
    'web3-wallet',
    'onetap',
  ])('renders the %s form from defaults when nothing is loaded', (providerId) => {
    renderPanel(providerId)
    expect(screen.getByText('render error')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    cleanup()
  })

  it('renders the passkey form with "Not loaded" relying party when security is absent', () => {
    renderPanel('passkey')
    expect(screen.getByText('Not loaded')).toBeTruthy()
    cleanup()
  })

  it('renders the runtime fallback for an unknown built-in provider', () => {
    renderPanel('mystery')
    expect(screen.getByText('Provider runtime')).toBeTruthy()
  })
})

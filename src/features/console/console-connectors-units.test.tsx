import type { ConnectorResponse, ConnectorTemplate } from '@shared/api/connectors'
import type { ManagementSignInSettingsResponse } from '@shared/api/management'
import type { SecurityPolicyResponse } from '@shared/api/security'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ProviderRuntime } from '@/features/console/extracted/connectors/builtin-provider-controls'
import { BuiltinProviderPanel } from '@/features/console/extracted/connectors/builtin-provider-panel'
import { connectorProviderRows } from '@/features/console/extracted/connectors/provider-rows'
import {
  CallbackUrlField,
  ConnectorDynamicFields,
  connectorCallbackUrl,
  GenericConnectorFields,
} from '@/features/console/extracted/connectors/social-fields'
import { connector, connectorTemplates, securityPolicy, signInSettings } from './console.test-utils'

const templates = connectorTemplates.items as ConnectorTemplate[]

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
      securityPolicy.policy as SecurityPolicyResponse,
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

  it('keeps OIDC connectors out of the built-in and social provider rows', () => {
    const unmatchedOAuth = {
      ...connector,
      id: 'connector-oauth',
      providerId: 'partner-oauth',
      providerType: 'generic_oauth',
      displayName: 'Partner OAuth',
    } as ConnectorResponse
    const googleWithoutSecret = {
      ...connector,
      providerId: 'google',
      providerType: 'social',
      clientSecretConfigured: false,
    } as ConnectorResponse

    const rows = connectorProviderRows(templates, [unmatchedOAuth, googleWithoutSecret], undefined, undefined)
    const byProvider = Object.fromEntries(rows.map((row) => [row.providerId, row]))

    expect(byProvider.google.configurationLabel).toBe('Credentials required')
    expect(byProvider['partner-oauth']).toBeUndefined()
  })

  it('describes configured and unconfigured generic OIDC templates', () => {
    const oidcTemplate = {
      ...templates[0]!,
      providerType: 'generic_oauth' as const,
      providerId: 'enterprise-oidc',
      displayName: 'Enterprise OIDC',
    }
    const configured = {
      ...connector,
      providerType: 'generic_oauth' as const,
      providerId: 'enterprise-oidc',
      clientSecretConfigured: false,
    } as ConnectorResponse

    const configuredRow = connectorProviderRows([oidcTemplate], [configured], undefined, undefined).at(-1)
    const emptyRow = connectorProviderRows([oidcTemplate], [], undefined, undefined).at(-1)

    expect(configuredRow).toMatchObject({
      description: 'Standards-based OAuth/OIDC connector',
      typeLabel: 'OIDC',
      configurationLabel: 'Boundary configured',
    })
    expect(emptyRow).toMatchObject({
      configurationLabel: 'Not configured',
      enabled: false,
    })
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
      capabilities: { authentication: true, resourceAuthorization: false },
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
      capabilities: { authentication: true, resourceAuthorization: false },
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

  it('merges duplicate supported fields and ignores non-product fields', () => {
    const template = {
      providerType: 'social' as const,
      providerId: 'custom',
      displayName: 'Custom',
      icon: 'custom',
      capabilities: { authentication: true, resourceAuthorization: false },
      requiredFields: ['providerMetadata.domain'],
      optionalFields: ['providerMetadata.domain', 'unknown'],
      defaultScopes: [],
      endpoints: {
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
      },
    }
    render(<ConnectorDynamicFields form={{}} isExisting={false} setForm={() => {}} template={template} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox').hasAttribute('required')).toBe(true)
  })
})

describe('GenericConnectorFields', () => {
  it('renders and updates the generic OAuth field set for create and edit', () => {
    const setForm = vi.fn()
    const { rerender } = render(<GenericConnectorFields form={{}} isExisting={false} setForm={setForm} />)
    expect(screen.getByLabelText('Client Secret').getAttribute('type')).toBe('password')
    expect(screen.getByLabelText('Client Secret').hasAttribute('required')).toBe(true)
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-1' } })
    expect(setForm).toHaveBeenCalled()

    rerender(<GenericConnectorFields form={{}} isExisting setForm={setForm} />)
    expect(screen.getByText('Leave blank to keep the current secret.')).toBeTruthy()
    expect(screen.getByLabelText('Client Secret').hasAttribute('required')).toBe(false)
  })

  it('copies the callback URL', () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<CallbackUrlField value="https://auth.example.com/callback" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('https://auth.example.com/callback')
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

  it('renders empty passkey relying-party fields when security is absent', () => {
    renderPanel('passkey')
    expect(screen.getByLabelText('Relying party name')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Relying party ID')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Allowed origins')).toHaveProperty('value', '')
    cleanup()
  })

  it('renders the runtime fallback for an unknown built-in provider', () => {
    renderPanel('mystery')
    expect(screen.getByText('Provider runtime')).toBeTruthy()
  })
})

import type {
  ConnectorResponse,
  ConnectorTemplate,
  ManagementSignInSettingsResponse,
  SecurityPolicy,
} from '../../console-shared'

export type ConnectorProviderRow = {
  key: string
  displayName: string
  description: string
  icon: string
  providerId: string
  providerType: 'builtin' | 'social' | 'generic_oauth' | 'generic_api'
  typeLabel: string
  configurationLabel: string
  enabled: boolean
  connector: ConnectorResponse | null
  template: ConnectorTemplate | null
}
export function connectorProviderRows(
  templates: ConnectorTemplate[],
  connectors: ConnectorResponse[],
  signInSettings: ManagementSignInSettingsResponse | undefined,
  security: SecurityPolicy | undefined,
): ConnectorProviderRow[] {
  const connectorsByProvider = new Map(connectors.map((connector) => [connector.providerId, connector]))
  const builtIn = signInSettings?.builtInProviders
  const connectorRows = templates.map((template) => {
    const connector = connectorsByProvider.get(template.providerId) ?? null
    const generic = template.providerType !== 'social'
    return {
      key: `${template.providerType}:${template.providerId}`,
      displayName: template.displayName,
      description: connectorDescription(template.providerType),
      icon: template.icon,
      providerId: template.providerId,
      providerType: template.providerType,
      typeLabel: connectorTypeLabel(template.providerType),
      configurationLabel: connector
        ? generic
          ? 'Boundary configured'
          : connector.clientSecretConfigured
            ? 'Credentials configured'
            : 'Credentials required'
        : generic
          ? 'Not configured'
          : 'Credentials required',
      enabled: connector?.enabled ?? false,
      connector,
      template,
    }
  })
  const unmatchedGenericRows = connectors
    .filter(
      (connector) =>
        connector.providerType !== 'social' && !templates.some((t) => t.providerId === connector.providerId),
    )
    .map((connector) => ({
      key: `${connector.providerType}:${connector.id}`,
      displayName: connector.displayName,
      description: connectorDescription(connector.providerType),
      icon: connector.providerType === 'generic_api' ? 'api' : 'oauth',
      providerId: connector.providerId,
      providerType: connector.providerType,
      typeLabel: connectorTypeLabel(connector.providerType),
      configurationLabel: 'Boundary configured',
      enabled: connector.enabled,
      connector,
      template: null,
    }))
  return [
    {
      key: 'builtin:email',
      displayName: 'Email',
      description: 'Email sign-in provider',
      icon: 'email',
      providerId: 'email',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.email.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.email.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:phone',
      displayName: 'Phone (SMS)',
      description: 'SMS sign-in provider',
      icon: 'phone',
      providerId: 'phone',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.phone.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.phone.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:web3-wallet',
      displayName: 'Web3 wallet',
      description: 'Wallet-based sign-in provider',
      icon: 'wallet',
      providerId: 'web3-wallet',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.web3Wallet.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.web3Wallet.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:passkey',
      displayName: 'Passkey',
      description: 'Passkey authentication provider',
      icon: 'passkey',
      providerId: 'passkey',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: security?.passkeys.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(security?.passkeys.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:onetap',
      displayName: 'OneTap',
      description: 'One-tap sign-in provider',
      icon: 'onetap',
      providerId: 'onetap',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.oneTap.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.oneTap.enabled),
      connector: null,
      template: null,
    },
    ...connectorRows,
    ...unmatchedGenericRows,
  ]
}

function connectorTypeLabel(providerType: 'social' | 'generic_oauth' | 'generic_api') {
  if (providerType === 'generic_oauth') return 'Generic OAuth'
  if (providerType === 'generic_api') return 'Generic API'
  return 'Social'
}

function connectorDescription(providerType: 'social' | 'generic_oauth' | 'generic_api') {
  if (providerType === 'generic_oauth') return 'Standards-based OAuth/OIDC connector'
  if (providerType === 'generic_api') return 'Credential-broker API boundary'
  return 'Social sign-in provider'
}

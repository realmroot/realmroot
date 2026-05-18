import type { ConnectorProviderType, ConnectorTemplate } from '../../../shared/api/connectors'

export const socialProviderIds = [
  'apple',
  'atlassian',
  'cognito',
  'discord',
  'dropbox',
  'facebook',
  'figma',
  'github',
  'gitlab',
  'google',
  'huggingface',
  'kick',
  'kakao',
  'linear',
  'linkedin',
  'line',
  'microsoft',
  'naver',
  'notion',
  'paybin',
  'paypal',
  'polar',
  'railway',
  'reddit',
  'roblox',
  'salesforce',
  'slack',
  'spotify',
  'tiktok',
  'twitch',
  'twitter',
  'vercel',
  'vk',
  'wechat',
  'zoom',
] as const

const socialTemplates = socialProviderIds.map((providerId) => ({
  providerType: 'social' as const,
  providerId,
  displayName: displayName(providerId),
  requiredFields: requiredSocialFields(providerId),
  optionalFields: optionalSocialFields(providerId).map((field) => `providerMetadata.${field}`),
  defaultScopes: defaultScopes(providerId),
}))

export const connectorTemplates: ConnectorTemplate[] = [
  ...socialTemplates,
  {
    providerType: 'generic_oauth',
    providerId: 'generic-oauth',
    displayName: 'Generic OAuth',
    requiredFields: ['clientId', 'clientSecretBinding', 'issuer or authorizationEndpoint + tokenEndpoint'],
    optionalFields: [
      'scopes',
      'issuer',
      'authorizationEndpoint',
      'tokenEndpoint',
      'userInfoEndpoint',
      'jwksEndpoint',
      'providerMetadata.redirectURI',
      'providerMetadata.pkce',
      'providerMetadata.requireIssuerValidation',
      'providerMetadata.disableImplicitSignUp',
      'providerMetadata.disableSignUp',
      'providerMetadata.overrideUserInfo',
    ],
    defaultScopes: ['openid', 'email', 'profile'],
  },
]

export function isSupportedProvider(providerType: ConnectorProviderType, providerId: string) {
  if (providerType === 'generic_oauth') return true
  return socialProviderIds.includes(providerId as (typeof socialProviderIds)[number])
}

function displayName(providerId: string) {
  if (providerId === 'github') return 'GitHub'
  if (providerId === 'gitlab') return 'GitLab'
  if (providerId === 'google') return 'Google'
  if (providerId === 'microsoft') return 'Microsoft'
  if (providerId === 'paypal') return 'PayPal'
  if (providerId === 'paybin') return 'Paybin'
  if (providerId === 'vk') return 'VK'
  if (providerId === 'wechat') return 'WeChat'
  return providerId
    .split('-')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function requiredSocialFields(providerId: string) {
  if (providerId === 'cognito') {
    return [
      'clientId',
      'clientSecretBinding',
      'providerMetadata.domain',
      'providerMetadata.region',
      'providerMetadata.userPoolId',
    ]
  }
  return ['clientId', 'clientSecretBinding']
}

function optionalSocialFields(providerId: string) {
  const fields = ['scopes', 'redirectURI', 'disableImplicitSignUp', 'disableSignUp', 'overrideUserInfo']
  if (providerId === 'apple') return [...fields, 'appBundleIdentifier', 'audience']
  if (providerId === 'google') return [...fields, 'accessType', 'display', 'hd']
  if (providerId === 'cognito') return [...fields, 'requireClientSecret']
  return fields
}

function defaultScopes(providerId: string) {
  if (providerId === 'github') return ['read:user', 'user:email']
  if (providerId === 'discord') return ['identify', 'email']
  if (providerId === 'slack') return ['openid', 'email', 'profile']
  return ['openid', 'email', 'profile']
}

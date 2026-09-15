export const defaultAccountCenterSettings = {
  profileEditingEnabled: true,
  displayNameEditable: true,
  usernameEditable: true,
  avatarEditable: true,
  emailChangeEnabled: true,
  passwordChangeEnabled: true,
  connectedAccountsEnabled: true,
  sessionsViewEnabled: true,
  dangerZoneEnabled: false,
}

export type AccountCenterSection =
  | 'overview'
  | 'profile'
  | 'security'
  | 'data-privacy'
  | 'connections'
  | 'applications'
  | 'agents'
  | 'organizations'

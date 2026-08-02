import { ChevronsUpDown, Download, KeyRound, LockKeyhole, Mail, Pencil, UserRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Field, SelectInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  changeAccountPassword,
  confirmAccountEmailChange,
  listAccountAgents,
  listAccountOrganizations,
  listAccountSessions,
  listConsentedApplications,
  listLinkedAccounts,
  requestAccountEmailChange,
  updateAccountProfile,
  uploadAccountAvatar,
} from '@/lib/api/account'
import { i18n, normalizeLanguage, type SupportedLanguage, tt } from '@/lib/i18n'
import { AccountPageHeader, AccountRow, AccountRows, AccountTabContent, AccountTabs } from './account-page'
import { AccountPageError, AccountPageLoading, AccountPageShell } from './account-shell'
import { SettingsAction, UnavailableSection } from './primitives'
import { ProfileDialogs } from './profile-dialogs'
import {
  accountQueryKeys,
  useAccountConfig,
  useAccountMutation,
  useAccountProfile,
  useDeveloperConsoleAccess,
} from './queries'
import { defaultAccountCenterSettings } from './settings'
import type { MutationHandler, UserProfile } from './types'
import { accountTimeZones, readAccountTimeZone, saveAccountTimeZone } from './utils'

export function AccountProfilePage() {
  const configQuery = useAccountConfig()
  const profileQuery = useAccountProfile()
  const accessQuery = useDeveloperConsoleAccess()
  const mutate = useAccountMutation()
  const [tab, setTab] = useState('details')
  const [action, setAction] = useState<'language' | 'timezone' | null>(null)
  const [language, setLanguage] = useState<SupportedLanguage>(() => normalizeLanguage(i18n.language))
  const [timezone, setTimezone] = useState(readAccountTimeZone)
  const config = configQuery.data ?? null
  const accountCenter = config?.accountCenter ?? defaultAccountCenterSettings
  const error = configQuery.error ?? profileQuery.error ?? accessQuery.error
  if (configQuery.isLoading || profileQuery.isLoading || accessQuery.isLoading)
    return <AccountPageLoading config={config} />
  if (error)
    return <AccountPageError config={config} message={error instanceof Error ? error.message : tt('Unable to load.')} />
  const profile = profileQuery.data?.user ?? null
  const access = accessQuery.data
  if (!access) return <AccountPageError config={config} message={tt('Unable to load account center.')} />
  return (
    <AccountPageShell access={access} accountCenter={accountCenter} config={config} profile={profile} section="profile">
      <AccountPageHeader
        description={tt('Manage the identity information Realmroot shares with trusted applications.')}
        title={tt('Profile')}
      />
      <AccountTabs
        onValueChange={setTab}
        tabs={[
          { value: 'details', label: tt('Identity details') },
          { value: 'preferences', label: tt('Preferences') },
          { value: 'account', label: tt('Account') },
        ]}
        value={tab}
      >
        <AccountTabContent value="details">
          {profile && accountCenter.profileEditingEnabled ? (
            <ProfileSections accountCenter={accountCenter} profile={profile} mutate={mutate} />
          ) : (
            <UnavailableSection message={tt('Profile editing is disabled for this account center.')} />
          )}
        </AccountTabContent>
        <AccountTabContent value="preferences">
          <AccountRows>
            <AccountRow
              action={
                <Button onClick={() => setAction('language')} variant="outline">
                  {tt('Change')}
                </Button>
              }
              label={tt('Language')}
              value={language === 'zh' ? tt('Simplified Chinese') : tt('English')}
            />
            <AccountRow
              action={
                <Button onClick={() => setAction('timezone')} variant="outline">
                  {tt('Change')}
                </Button>
              }
              label={tt('Time zone')}
              value={timezone}
            />
          </AccountRows>
        </AccountTabContent>
        <AccountTabContent value="account">
          <AccountRows>
            <AccountRow
              action={
                <Button
                  onClick={() => {
                    if (!profile) return
                    void mutate('Account data downloaded.', () =>
                      downloadAccountData(profile, {
                        includeApplications: accountCenter.connectedAccountsEnabled,
                        includeLinkedAccounts: accountCenter.connectedAccountsEnabled,
                        includeSessions: accountCenter.sessionsViewEnabled,
                      }),
                    )
                  }}
                  variant="outline"
                >
                  <Download />
                  {tt('Download data')}
                </Button>
              }
              description={tt('Receive a machine-readable copy of your profile and grants.')}
              label={tt('Export account data')}
              value={tt('JSON')}
            />
          </AccountRows>
        </AccountTabContent>
      </AccountTabs>
      <ProfileActionDialog
        action={action}
        language={language}
        onClose={() => setAction(null)}
        onLanguageChange={setLanguage}
        onTimezoneChange={setTimezone}
        timezone={timezone}
      />
    </AccountPageShell>
  )
}

function ProfileActionDialog({
  action,
  language,
  onClose,
  onLanguageChange,
  onTimezoneChange,
  timezone,
}: {
  action: 'language' | 'timezone' | null
  language: SupportedLanguage
  onClose: () => void
  onLanguageChange: (value: SupportedLanguage) => void
  onTimezoneChange: (value: string) => void
  timezone: string
}) {
  const [draftLanguage, setDraftLanguage] = useState(language)
  const [draftTimezone, setDraftTimezone] = useState(timezone)
  useEffect(() => {
    if (!action) return
    setDraftLanguage(language)
    setDraftTimezone(timezone)
  }, [action, language, timezone])
  const title = action === 'language' ? tt('Change language') : tt('Change time zone')
  async function save() {
    if (action === 'language') {
      await i18n.changeLanguage(draftLanguage)
      onLanguageChange(draftLanguage)
    }
    if (action === 'timezone') {
      saveAccountTimeZone(draftTimezone)
      onTimezoneChange(draftTimezone)
    }
    toast.success(tt('Preferences updated'))
    onClose()
  }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={action !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {tt('Choose how dates, times, and interface copy are presented in this browser.')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {action === 'language' ? (
            <Field label={tt('Language')}>
              <SelectInput
                name="language"
                onChange={(event) => setDraftLanguage(event.target.value as SupportedLanguage)}
                value={draftLanguage}
              >
                <option value="en">English</option>
                <option value="zh">简体中文</option>
              </SelectInput>
            </Field>
          ) : null}
          {action === 'timezone' ? <TimeZonePicker onChange={setDraftTimezone} value={draftTimezone} /> : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button onClick={() => void save()}>{tt('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TimeZonePicker({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Field label={tt('Time zone')}>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={tt('Time zone')}
            aria-expanded={open}
            className="w-full justify-between font-normal"
            role="combobox"
            variant="outline"
          >
            <span className="truncate">{value}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput placeholder={tt('Search time zones…')} />
            <CommandList>
              <CommandEmpty>{tt('No matching time zones.')}</CommandEmpty>
              <CommandGroup>
                {accountTimeZones.map((option) => (
                  <CommandItem
                    data-checked={option === value}
                    key={option}
                    onSelect={() => {
                      onChange(option)
                      setOpen(false)
                    }}
                    value={option}
                  >
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  )
}

async function downloadAccountData(
  profile: UserProfile,
  options: { includeApplications: boolean; includeLinkedAccounts: boolean; includeSessions: boolean },
) {
  const [organizations, agents, applications, linkedAccounts, sessions] = await Promise.all([
    listAccountOrganizations(),
    listAccountAgents(),
    options.includeApplications ? listConsentedApplications() : Promise.resolve({ applications: [] }),
    options.includeLinkedAccounts ? listLinkedAccounts() : Promise.resolve({ accounts: [] }),
    options.includeSessions ? listAccountSessions() : Promise.resolve({ sessions: [], pagination: null }),
  ])
  const exportedAt = new Date().toISOString()
  const document = {
    format: 'realmroot-account-export',
    version: 1,
    exportedAt,
    profile,
    organizations,
    agents: agents.items,
    applications: applications.applications,
    linkedAccounts: linkedAccounts.accounts,
    sessions: sessions.sessions,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.download = `realmroot-account-${exportedAt.slice(0, 10)}.json`
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
  return document
}

export function ProfilePasswordPanel({ profile }: { profile: UserProfile }) {
  const mutate = useAccountMutation()
  const accountCenter = defaultAccountCenterSettings
  return <ProfileSections accountCenter={accountCenter} mode="password" profile={profile} mutate={mutate} />
}

function ProfileSections({
  accountCenter,
  mode = 'profile-account',
  profile,
  mutate,
}: {
  accountCenter: typeof defaultAccountCenterSettings
  mode?: 'profile-account' | 'password'
  profile: UserProfile
  mutate: MutationHandler
}) {
  const [dialog, setDialog] = useState<'avatar' | 'displayName' | 'username' | 'email' | 'password' | null>(null)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [username, setUsername] = useState(profile.username ?? '')
  const [avatarAssetId, setAvatarAssetId] = useState(profile.avatarAssetId ?? '')
  const [avatarPreview, setAvatarPreview] = useState(profile.image ?? '')
  const [email, setEmail] = useState(profile.email)
  const [emailOtp, setEmailOtp] = useState('')
  const [emailStep, setEmailStep] = useState<'request' | 'confirm'>('request')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  useEffect(() => {
    setDisplayName(profile.displayName)
    setUsername(profile.username ?? '')
    setAvatarAssetId(profile.avatarAssetId ?? '')
    setAvatarPreview(profile.image ?? '')
    setEmail(profile.email)
    setEmailOtp('')
    setEmailStep('request')
  }, [profile])
  function closeDialog() {
    setDialog(null)
    setDisplayName(profile.displayName)
    setUsername(profile.username ?? '')
    setAvatarAssetId(profile.avatarAssetId ?? '')
    setAvatarPreview(profile.image ?? '')
    setEmail(profile.email)
    setEmailOtp('')
    setEmailStep('request')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    const input =
      dialog === 'avatar'
        ? { avatarAssetId: avatarAssetId || null }
        : dialog === 'displayName'
          ? { displayName }
          : dialog === 'username'
            ? { username: username || null }
            : null
    if (!input) return
    const result = await mutate('Profile updated.', () => updateAccountProfile(input), {
      invalidate: [accountQueryKeys.profile],
    })
    if (result) setDialog(null)
  }
  async function changeEmail(event: FormEvent) {
    event.preventDefault()
    if (emailStep === 'request') {
      const result = await mutate('Verification code sent.', () => requestAccountEmailChange({ email }))
      if (result) {
        setEmailOtp('')
        setEmailStep('confirm')
      }
      return
    }
    const result = await mutate('Email changed.', () => confirmAccountEmailChange({ email, otp: emailOtp }), {
      invalidate: [accountQueryKeys.profile],
    })
    if (result) {
      setEmailOtp('')
      setEmailStep('request')
      setDialog(null)
    }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError(tt('New passwords do not match.'))
      return
    }
    const result = await mutate(
      'Password changed.',
      () => changeAccountPassword({ currentPassword, newPassword, revokeOtherSessions: true }),
      { invalidate: [accountQueryKeys.sessions], onError: setPasswordError },
    )
    if (result) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordError(null)
      setDialog(null)
    }
  }
  function uploadAvatar(file: File | undefined) {
    if (!file) return
    return mutate('Avatar uploaded.', () => uploadAccountAvatar(file)).then((response) => {
      if (response) {
        setAvatarAssetId(response.asset.id)
        setAvatarPreview(response.asset.publicUrl)
      }
      return response
    })
  }
  return (
    <>
      {mode === 'profile-account' ? (
        <>
          <ProfileIdentityRows accountCenter={accountCenter} profile={profile} setDialog={setDialog} />
          <ProfileIdentifierRows accountCenter={accountCenter} profile={profile} setDialog={setDialog} />
        </>
      ) : null}
      {accountCenter.passwordChangeEnabled && mode === 'password' ? (
        <section className="settingsPanel">
          <SettingsAction
            action={
              <Button onClick={() => setDialog('password')} type="button" variant="secondary">
                <KeyRound size={18} /> {tt('Change password')}
              </Button>
            }
            icon={<LockKeyhole size={18} />}
            meta={tt('Use this when you need to rotate your hosted sign-in password.')}
            title={tt('Password')}
            value={tt('Hosted sign-in')}
          />
        </section>
      ) : null}
      <ProfileDialogs
        avatarPreview={avatarPreview}
        changeEmail={changeEmail}
        changePassword={changePassword}
        closeDialog={closeDialog}
        confirmPassword={confirmPassword}
        currentPassword={currentPassword}
        dialog={dialog}
        displayName={displayName}
        email={email}
        emailOtp={emailOtp}
        emailStep={emailStep}
        newPassword={newPassword}
        passwordError={passwordError}
        profile={profile}
        saveProfile={saveProfile}
        setConfirmPassword={setConfirmPassword}
        setCurrentPassword={setCurrentPassword}
        setDisplayName={setDisplayName}
        setEmail={setEmail}
        setEmailOtp={setEmailOtp}
        setEmailStep={setEmailStep}
        setNewPassword={setNewPassword}
        setUsername={setUsername}
        uploadAvatar={uploadAvatar}
        username={username}
      />
    </>
  )
}

function ProfileIdentityRows({
  accountCenter,
  profile,
  setDialog,
}: {
  accountCenter: typeof defaultAccountCenterSettings
  profile: UserProfile
  setDialog: (dialog: 'avatar' | 'displayName') => void
}) {
  return (
    <section className="settingsPanel">
      {accountCenter.avatarEditable ? (
        <SettingsAction
          action={
            <Button onClick={() => setDialog('avatar')} type="button" variant="secondary">
              <Pencil size={16} /> {tt('Change avatar')}
            </Button>
          }
          icon={
            profile.image ? (
              <img alt="" className="accountProfileRowAvatar" src={profile.image} width="36" height="36" />
            ) : (
              <UserRound size={18} />
            )
          }
          meta={tt('Shown across trusted applications.')}
          title={tt('Avatar')}
          value={profile.image ? tt('Custom image') : tt('Default avatar')}
        />
      ) : null}
      {accountCenter.displayNameEditable ? (
        <SettingsAction
          action={
            <Button onClick={() => setDialog('displayName')} type="button" variant="secondary">
              <Pencil size={16} /> {tt('Edit display name')}
            </Button>
          }
          icon={<UserRound size={18} />}
          meta={tt('Shown across trusted applications.')}
          title={tt('Display name')}
          value={profile.displayName}
        />
      ) : null}
    </section>
  )
}

function ProfileIdentifierRows({
  accountCenter,
  profile,
  setDialog,
}: {
  accountCenter: typeof defaultAccountCenterSettings
  profile: UserProfile
  setDialog: (dialog: 'username' | 'email') => void
}) {
  if (!accountCenter.usernameEditable && !accountCenter.emailChangeEnabled) return null
  return (
    <section className="settingsPanel">
      {accountCenter.usernameEditable ? (
        <SettingsAction
          action={
            <Button onClick={() => setDialog('username')} type="button" variant="secondary">
              {tt('Edit username')}
            </Button>
          }
          icon={<UserRound size={18} />}
          meta={tt('Public account handle.')}
          title={tt('Username')}
          value={profile.username ? `@${profile.username}` : tt('No username set')}
        />
      ) : null}
      {accountCenter.emailChangeEnabled ? (
        <SettingsAction
          action={
            <Button onClick={() => setDialog('email')} type="button" variant="secondary">
              <Mail size={18} /> {tt('Change email')}
            </Button>
          }
          icon={<Mail size={18} />}
          meta={tt('Used for sign-in and account notifications.')}
          status={profile.emailVerified ? tt('Verified') : tt('Unverified')}
          title={tt('Email')}
          value={profile.email}
        />
      ) : null}
    </section>
  )
}

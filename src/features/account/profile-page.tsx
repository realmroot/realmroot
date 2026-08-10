import { Link } from '@tanstack/react-router'
import { ChevronsUpDown, Download, Globe2, LockKeyhole, Mail, Plus, Trash2, UserRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Field, SelectInput, TextArea, TextInput } from '@/components/product-form'
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
  listAccountApplicationAuthorizations,
  listAccountOrganizations,
  listAccountSessions,
  listLinkedAccounts,
  requestAccountEmailChange,
  updateAccountProfile,
  uploadAccountAvatar,
} from '@/lib/api/account'
import { i18n, normalizeLanguage, type SupportedLanguage, tt } from '@/lib/i18n'
import { AccountPageHeader, AccountRow, AccountRows, AccountTabContent, AccountTabs } from './account-page'
import { useAccountCenterLayout } from './account-surface'
import { SettingsAction, UnavailableSection } from './primitives'
import { ProfileDialogs } from './profile-dialogs'
import { accountQueryKeys, useAccountMutation, useLinkedAccounts } from './queries'
import { defaultAccountCenterSettings } from './settings'
import type { MutationHandler, UserProfile } from './types'
import { accountTimeZones, readAccountTimeZone, saveAccountTimeZone } from './utils'

export function AccountProfilePage() {
  const { accountCenter, profile } = useAccountCenterLayout()
  const mutate = useAccountMutation()
  const [tab, setTab] = useState('details')
  const [action, setAction] = useState<'language' | 'timezone' | null>(null)
  const [language, setLanguage] = useState<SupportedLanguage>(() => normalizeLanguage(i18n.language))
  const [timezone, setTimezone] = useState(readAccountTimeZone)
  return (
    <>
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
        <AccountTabContent surface value="details">
          {profile && accountCenter.profileEditingEnabled ? (
            <ProfileSections accountCenter={accountCenter} profile={profile} mutate={mutate} />
          ) : (
            <UnavailableSection message={tt('Profile editing is disabled for this account center.')} />
          )}
        </AccountTabContent>
        <AccountTabContent surface value="preferences">
          <AccountRows>
            <AccountRow
              action={
                <Button onClick={() => setAction('language')} size="sm" variant="outline">
                  {tt('Change')}
                </Button>
              }
              label={tt('Language')}
              value={language === 'zh' ? tt('Simplified Chinese') : tt('English')}
            />
            <AccountRow
              action={
                <Button onClick={() => setAction('timezone')} size="sm" variant="outline">
                  {tt('Change')}
                </Button>
              }
              label={tt('Time zone')}
              value={timezone}
            />
          </AccountRows>
        </AccountTabContent>
        <AccountTabContent surface value="account">
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
                  size="sm"
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
    </>
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
    options.includeApplications
      ? listAccountApplicationAuthorizations()
      : Promise.resolve({ authorizations: [], pagination: null }),
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
    applications: applications.authorizations,
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
  const [publicProfileOpen, setPublicProfileOpen] = useState(false)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [username, setUsername] = useState(profile.username ?? '')
  const [avatarAssetId, setAvatarAssetId] = useState(profile.avatarAssetId ?? '')
  const [avatarPreview, setAvatarPreview] = useState(profile.image ?? '')
  const [email, setEmail] = useState(profile.email)
  const [bio, setBio] = useState(profile.bio ?? '')
  const [location, setLocation] = useState(profile.location ?? '')
  const [links, setLinks] = useState(() => publicProfileLinkDrafts(profile.links))
  const [emailOtp, setEmailOtp] = useState('')
  const [emailStep, setEmailStep] = useState<'request' | 'confirm'>('request')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const linkedAccountsQuery = useLinkedAccounts(publicProfileOpen && accountCenter.connectedAccountsEnabled)
  const projectableAccounts = (linkedAccountsQuery.data?.accounts ?? []).filter(
    (account) => account.providerId !== 'credential',
  )
  const availableAccounts = projectableAccounts.filter(
    (account) => !links.some((link) => link.type === 'linked-account' && link.accountId === account.id),
  )
  useEffect(() => {
    setDisplayName(profile.displayName)
    setUsername(profile.username ?? '')
    setAvatarAssetId(profile.avatarAssetId ?? '')
    setAvatarPreview(profile.image ?? '')
    setEmail(profile.email)
    setBio(profile.bio ?? '')
    setLocation(profile.location ?? '')
    setLinks(publicProfileLinkDrafts(profile.links))
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
    setBio(profile.bio ?? '')
    setLocation(profile.location ?? '')
    setLinks(publicProfileLinkDrafts(profile.links))
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
  async function savePublicProfile(event: FormEvent) {
    event.preventDefault()
    const result = await mutate(
      'Public profile updated.',
      () =>
        updateAccountProfile({
          bio: bio || null,
          location: location || null,
          links: links.map(({ key: _key, ...link }) => link),
        }),
      { invalidate: [accountQueryKeys.profile] },
    )
    if (result) setPublicProfileOpen(false)
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
          <section className="settingsPanel">
            <SettingsAction
              action={
                <Button
                  aria-label={tt('Edit public profile')}
                  onClick={() => setPublicProfileOpen(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {tt('Edit')}
                </Button>
              }
              icon={<Globe2 size={18} />}
              meta={tt('Bio, location, and links shown on your public profile.')}
              title={tt('Public profile')}
              value={
                profile.username ? (
                  <Link
                    className="underline-offset-4 hover:underline"
                    params={{ username: profile.username }}
                    to="/u/$username"
                  >
                    /u/{profile.username}
                  </Link>
                ) : (
                  tt('Set a username to publish')
                )
              }
            />
          </section>
        </>
      ) : null}
      {accountCenter.passwordChangeEnabled && mode === 'password' ? (
        <section className="settingsPanel">
          <SettingsAction
            action={
              <Button
                aria-label={tt('Change password')}
                onClick={() => setDialog('password')}
                size="sm"
                type="button"
                variant="outline"
              >
                {tt('Change')}
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
      <Dialog onOpenChange={setPublicProfileOpen} open={publicProfileOpen}>
        <DialogContent className="sm:max-w-xl">
          <form onSubmit={savePublicProfile}>
            <DialogHeader>
              <DialogTitle>{tt('Edit public profile')}</DialogTitle>
              <DialogDescription>{tt('Only these fields are visible to external visitors.')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 py-5">
              <Field label={tt('Bio')}>
                <TextArea maxLength={500} onChange={(event) => setBio(event.target.value)} rows={4} value={bio} />
              </Field>
              <Field label={tt('Location')}>
                <TextInput maxLength={100} onChange={(event) => setLocation(event.target.value)} value={location} />
              </Field>
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm">{tt('Links & identities')}</strong>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={links.length >= 10}
                      onClick={() =>
                        setLinks([...links, { key: crypto.randomUUID(), type: 'website', label: '', url: '' }])
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Plus /> {tt('Add website')}
                    </Button>
                    {accountCenter.connectedAccountsEnabled ? (
                      <Button
                        disabled={links.length >= 10 || availableAccounts.length === 0}
                        onClick={() => {
                          const account = availableAccounts[0]!
                          setLinks([
                            ...links,
                            {
                              key: crypto.randomUUID(),
                              type: 'linked-account',
                              accountId: account.id,
                              providerId: account.providerId,
                              label: providerLabel(account.providerId),
                              url: '',
                            },
                          ])
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Plus /> {tt('Add linked account')}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {linkedAccountsQuery.error ? (
                  <p className="text-sm text-destructive">{tt('Unable to load linked accounts.')}</p>
                ) : null}
                {links.map((link, index) => (
                  <div className="grid gap-2 sm:grid-cols-[140px_120px_minmax(0,1fr)_40px]" key={link.key}>
                    {link.type === 'linked-account' && accountCenter.connectedAccountsEnabled ? (
                      <SelectInput
                        aria-label={tt('Linked account')}
                        onChange={(event) => {
                          const account = projectableAccounts.find((candidate) => candidate.id === event.target.value)!
                          setLinks(
                            links.map((item, itemIndex) =>
                              itemIndex === index && item.type === 'linked-account'
                                ? {
                                    ...item,
                                    accountId: account.id,
                                    providerId: account.providerId,
                                    label: providerLabel(account.providerId),
                                  }
                                : item,
                            ),
                          )
                        }}
                        value={link.accountId}
                      >
                        {projectableAccounts.map((account) => (
                          <option
                            disabled={links.some(
                              (item, itemIndex) =>
                                itemIndex !== index && item.type === 'linked-account' && item.accountId === account.id,
                            )}
                            key={account.id}
                            value={account.id}
                          >
                            {providerLabel(account.providerId)}
                          </option>
                        ))}
                      </SelectInput>
                    ) : link.type === 'linked-account' ? (
                      <span className="flex items-center text-sm text-muted-foreground">
                        {providerLabel(link.providerId)}
                      </span>
                    ) : (
                      <span className="flex items-center text-sm text-muted-foreground">{tt('Website')}</span>
                    )}
                    <TextInput
                      aria-label={tt('Link label')}
                      maxLength={40}
                      onChange={(event) =>
                        setLinks(
                          links.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, label: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder={tt('Label')}
                      required
                      value={link.label}
                    />
                    <TextInput
                      aria-label={tt('Link URL')}
                      onChange={(event) =>
                        setLinks(
                          links.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, url: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder={
                        link.type === 'linked-account' ? 'https://provider.example/your-profile' : 'https://example.com'
                      }
                      required
                      type="url"
                      value={link.url}
                    />
                    <Button
                      aria-label={tt('Remove link')}
                      onClick={() => setLinks(links.filter((_, itemIndex) => itemIndex !== index))}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setPublicProfileOpen(false)} type="button" variant="outline">
                {tt('Cancel')}
              </Button>
              <Button type="submit">{tt('Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
            <Button
              aria-label={tt('Edit avatar')}
              onClick={() => setDialog('avatar')}
              size="sm"
              type="button"
              variant="outline"
            >
              {tt('Edit')}
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
            <Button
              aria-label={tt('Edit display name')}
              onClick={() => setDialog('displayName')}
              size="sm"
              type="button"
              variant="outline"
            >
              {tt('Edit')}
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

function publicProfileLinkDrafts(links: UserProfile['links']) {
  return links.map((link) => ({ ...link, key: crypto.randomUUID() }))
}

function providerLabel(providerId: string) {
  const brands: Record<string, string> = { github: 'GitHub', google: 'Google', linkedin: 'LinkedIn' }
  if (brands[providerId]) return brands[providerId]
  return providerId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
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
            <Button
              aria-label={tt('Edit username')}
              onClick={() => setDialog('username')}
              size="sm"
              type="button"
              variant="outline"
            >
              {tt('Edit')}
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
            <Button
              aria-label={tt('Edit email')}
              onClick={() => setDialog('email')}
              size="sm"
              type="button"
              variant="outline"
            >
              {tt('Edit')}
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

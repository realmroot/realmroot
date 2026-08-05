import { SwitchRow } from '@/features/management/dialogs'
import { ChangesSection, SettingsSection, SettingsSections, SignInExperiencePage } from '@/features/management/previews'
import {
  Button,
  ExternalLink,
  type FormEvent,
  tt,
  useEffect,
  useQuery,
  useQueryClient,
  useState,
} from '@/features/management/shared'
import { shallowEqual, useAdminMutation } from '@/features/management/utils'
import { consoleQueryKeys, getAccountCenterSettings, updateAccountCenterSettings } from '@/lib/api/management'

export function AccountCenterSettingsPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.accountCenter,
    queryFn: getAccountCenterSettings,
  })
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    profileEditingEnabled: true,
    displayNameEditable: true,
    usernameEditable: true,
    avatarEditable: true,
    emailChangeEnabled: true,
    passwordChangeEnabled: true,
    connectedAccountsEnabled: true,
    sessionsViewEnabled: true,
    dangerZoneEnabled: false,
  })
  const updateMutation = useAdminMutation({
    mutationFn: updateAccountCenterSettings,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.accountCenter,
      }),
  })
  useEffect(() => {
    if (query.data) setForm(query.data.accountCenter)
  }, [query.data])
  const loadedForm = query.data?.accountCenter ?? null
  const hasChanges = loadedForm ? !shallowEqual(form, loadedForm) : false
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    updateMutation.mutate({
      accountCenter: form,
    })
  }
  return (
    <SignInExperiencePage
      action={
        <Button onClick={() => window.open('/profile', '_blank', 'noopener')} type="button" variant="secondary">
          <ExternalLink data-icon="inline-start" /> {tt('Open account center')}{' '}
        </Button>
      }
      activeTab="account-center"
      description={tt(
        'Configure the self-service account center exposure and review available account management surfaces.',
      )}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => void query.refetch()}
      title={tt('Account Center')}
    >
      {query.data ? (
        <form onSubmit={onSubmit}>
          <SettingsSections>
            <SettingsSection
              title={tt('Visible sections')}
              description={tt('Choose which account center sections are visible to signed-in users.')}
            >
              <div className="grid gap-3">
                <SwitchRow
                  checked={form.profileEditingEnabled}
                  label={tt('Profile section')}
                  onCheckedChange={(profileEditingEnabled) =>
                    setForm((value) => ({
                      ...value,
                      profileEditingEnabled,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.passwordChangeEnabled}
                  label={tt('Password section')}
                  onCheckedChange={(passwordChangeEnabled) =>
                    setForm((value) => ({
                      ...value,
                      passwordChangeEnabled,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.connectedAccountsEnabled}
                  label={tt('Connected accounts and apps')}
                  onCheckedChange={(connectedAccountsEnabled) =>
                    setForm((value) => ({
                      ...value,
                      connectedAccountsEnabled,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.sessionsViewEnabled}
                  label={tt('Sessions section')}
                  onCheckedChange={(sessionsViewEnabled) =>
                    setForm((value) => ({
                      ...value,
                      sessionsViewEnabled,
                    }))
                  }
                />
              </div>
            </SettingsSection>
            <SettingsSection
              title={tt('Profile field permissions')}
              description={tt('Control which built-in profile fields users can edit from /profile.')}
            >
              <div className="grid gap-3">
                <SwitchRow
                  checked={form.displayNameEditable}
                  label={tt('Display name')}
                  onCheckedChange={(displayNameEditable) =>
                    setForm((value) => ({
                      ...value,
                      displayNameEditable,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.usernameEditable}
                  label={tt('Username')}
                  onCheckedChange={(usernameEditable) =>
                    setForm((value) => ({
                      ...value,
                      usernameEditable,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.avatarEditable}
                  label={tt('Avatar')}
                  onCheckedChange={(avatarEditable) =>
                    setForm((value) => ({
                      ...value,
                      avatarEditable,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.emailChangeEnabled}
                  label={tt('Email changes')}
                  onCheckedChange={(emailChangeEnabled) =>
                    setForm((value) => ({
                      ...value,
                      emailChangeEnabled,
                    }))
                  }
                />
              </div>
            </SettingsSection>
            <ChangesSection
              description={tt('Save account center visibility and field permissions.')}
              error={
                updateMutation.errorMessage ? (
                  <div className="text-sm text-destructive" role="alert">
                    {updateMutation.errorMessage}
                  </div>
                ) : null
              }
              onDiscard={() => {
                if (loadedForm) setForm(loadedForm)
              }}
              pending={updateMutation.isPending}
              saveLabel="Save account center"
              visible={hasChanges}
            />
          </SettingsSections>
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}

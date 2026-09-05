import { SettingsForm, SettingsFormSection } from '@/components/settings-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { SwitchRow } from '@/features/management/dialogs'
import { Button, type FormEvent, tt, useEffect, useQuery, useQueryClient, useState } from '@/features/management/shared'
import { shallowEqual, useAdminMutation } from '@/features/management/utils'
import { consoleQueryKeys, getAccountCenterSettings, updateAccountCenterSettings } from '@/lib/api/management'

export function AccountManagementSettings() {
  const [open, setOpen] = useState(false)
  const query = useQuery({
    enabled: open,
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.accountCenter })
      setOpen(false)
    },
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
    <SettingsFormSection
      title="Account permissions"
      description="Control which account center sections and profile fields users can manage."
    >
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (updateMutation.isPending) return
          if (next && query.data) setForm(query.data.accountCenter)
          setOpen(next)
        }}
      >
        <DialogTrigger asChild>
          <Button className="mt-3 w-fit" variant="secondary">
            {tt('Edit account permissions')}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tt('Account permissions')}</DialogTitle>
            <DialogDescription>
              {tt('Control which account center sections and profile fields users can manage.')}
            </DialogDescription>
          </DialogHeader>
          {query.isLoading ? <p role="status">{tt('Loading')}</p> : null}
          {query.error ? (
            <div role="alert">
              {query.error.message}
              <Button variant="link" onClick={() => void query.refetch()}>
                {tt('Retry')}
              </Button>
            </div>
          ) : null}
          {query.data ? (
            <SettingsForm
              onSubmit={onSubmit}
              dirty={hasChanges}
              pending={updateMutation.isPending}
              error={updateMutation.errorMessage}
              onDiscard={() => {
                if (loadedForm) setForm(loadedForm)
              }}
            >
              <div className="grid gap-4">
                <SettingsFormSection
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
                </SettingsFormSection>
                <SettingsFormSection
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
                </SettingsFormSection>
              </div>
            </SettingsForm>
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsFormSection>
  )
}

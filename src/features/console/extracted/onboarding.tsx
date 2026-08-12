import { useEffect } from 'react'
import { ApplicationTypeCards } from '@/features/management/create-dialogs'
import { SwitchRow } from '@/features/management/dialogs'
import { OrganizationOwnerField } from '@/features/management/ownership-controls'
import { ResourcePage, SetupChecklist } from '@/features/management/resource-components'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Copy,
  createApplicationRequestSchema,
  Field,
  Plus,
  SettingRow,
  TextArea,
  TextInput,
  tt,
  useNavigate,
  useQuery,
  useQueryClient,
  useState,
} from '@/features/management/shared'
import { parseForm, useAdminMutation } from '@/features/management/utils'
import { consoleQueryKeys, createApplication, getAdminReadiness, listOrganizations } from '@/lib/api/management'

export function ConsoleOnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const readinessQuery = useQuery({
    queryKey: consoleQueryKeys.readiness,
    queryFn: getAdminReadiness,
  })
  const organizationsQuery = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  const [ownerOrganizationId, setOwnerOrganizationId] = useState('')
  const [form, setForm] = useState({
    name: 'Customer portal',
    slug: 'customer-portal',
    clientType: 'public_spa',
    deviceLoginEnabled: false,
    redirectUris: `${window.location.origin}/oidc/callback`,
  })
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQueryKeys.applications,
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQueryKeys.readiness,
        }),
      ]),
  })
  const application = createMutation.data
  const setupComplete = readinessQuery.data?.admin.setupRequired === false
  const showApplicationSetup =
    Boolean(application) || readinessQuery.data?.admin.missing.includes('oidc_application') === true

  useEffect(() => {
    if (ownerOrganizationId) return
    setOwnerOrganizationId(organizationsQuery.data?.items[0]?.id ?? '')
  }, [organizationsQuery.data?.items, ownerOrganizationId, setOwnerOrganizationId])

  useEffect(() => {
    if (!setupComplete || application) return
    void navigate({ to: '/console' })
  }, [application, navigate, setupComplete])

  if (setupComplete && !application) return null

  return (
    <ResourcePage
      title={tt('Console setup')}
      description={tt(
        'Complete required setup gates, then review production recommendations without blocking the Console.',
      )}
      error={readinessQuery.error ?? createMutation.error}
      framed={false}
      loading={readinessQuery.isLoading}
      onRetry={() => readinessQuery.refetch()}
    >
      <div className={showApplicationSetup ? 'grid gap-4 xl:grid-cols-[1.05fr_0.95fr]' : 'max-w-3xl'}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{tt('Setup checklist')}</CardTitle>
                <CardDescription>
                  {' '}
                  {tt('Required items unlock Console routes. Recommended items prepare production.')}{' '}
                </CardDescription>
              </div>
              <Badge variant={readinessQuery.data?.admin?.setupRequired ? 'outline' : 'secondary'}>
                {readinessQuery.data?.admin?.setupRequired ? 'Action needed' : 'Ready'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SetupChecklist items={readinessQuery.data?.required ?? []} title={tt('Required')} />
            <SetupChecklist items={readinessQuery.data?.recommended ?? []} title={tt('Recommended')} />
          </CardContent>
        </Card>
        {showApplicationSetup ? (
          <Card>
            <CardHeader>
              <CardTitle>{tt('First OIDC application')}</CardTitle>
              <CardDescription>
                {tt('Use a localhost or review-environment callback while validating the flow.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="formStack applicationCreateForm"
                onSubmit={(event) => {
                  event.preventDefault()
                  createMutation.mutate(
                    parseForm(createApplicationRequestSchema, {
                      name: form.name,
                      slug: form.slug,
                      clientType: form.clientType,
                      firstParty: true,
                      ownerOrganizationId,
                      ...(form.clientType === 'public_native' ? { deviceLoginEnabled: form.deviceLoginEnabled } : {}),
                      redirectUris: form.clientType === 'machine' ? [] : form.redirectUris.split('\n').filter(Boolean),
                    }),
                  )
                }}
              >
                <OrganizationOwnerField
                  onChange={setOwnerOrganizationId}
                  organizations={organizationsQuery.data?.items ?? []}
                  value={ownerOrganizationId}
                />
                <ApplicationTypeCards
                  onChange={(clientType) =>
                    setForm((value) => ({
                      ...value,
                      clientType,
                      deviceLoginEnabled: clientType === 'public_native' ? value.deviceLoginEnabled : false,
                    }))
                  }
                  value={form.clientType}
                />
                {form.clientType === 'public_native' ? (
                  <SwitchRow
                    checked={form.deviceLoginEnabled}
                    label={tt('Device login')}
                    onCheckedChange={(deviceLoginEnabled) => setForm((value) => ({ ...value, deviceLoginEnabled }))}
                  />
                ) : null}
                <Field label={tt('Application name')}>
                  <TextInput
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        name: event.target.value,
                      }))
                    }
                    required
                    value={form.name}
                  />
                </Field>
                <Field label={tt('Slug')}>
                  <TextInput
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        slug: event.target.value,
                      }))
                    }
                    required
                    value={form.slug}
                  />
                </Field>
                {form.clientType === 'machine' ? null : (
                  <Field label={tt('Redirect URIs')}>
                    <TextArea
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          redirectUris: event.target.value,
                        }))
                      }
                      required
                      value={form.redirectUris}
                    />
                  </Field>
                )}
                <Button disabled={createMutation.isPending} type="submit">
                  <Plus data-icon="inline-start" /> {tt('Create application')}{' '}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
        {showApplicationSetup ? (
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>{tt('Client integration')}</CardTitle>
              <CardDescription>{tt('Use OIDC discovery with authorization code and PKCE.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <SettingRow
                label={tt('Discovery')}
                value={`${window.location.origin}/api/auth/.well-known/openid-configuration`}
              />
              <SettingRow label={tt('Issuer')} value={`${window.location.origin}/api/auth`} />
              <SettingRow label={tt('Callback')} value={form.redirectUris.split('\n')[0] ?? ''} />
              {application ? (
                <>
                  <SettingRow label={tt('Client ID')} value={application.clientId} />
                  <SettingRow label={tt('Auth method')} value={application.tokenEndpointAuthMethod} />
                  <SettingRow label={tt('OIDC scopes')} value={application.oidcScopes.join(' ')} />
                </>
              ) : null}
              <Button
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(
                      {
                        issuer: `${window.location.origin}/api/auth`,
                        discoveryUrl: `${window.location.origin}/api/auth/.well-known/openid-configuration`,
                        clientId: application?.clientId ?? '<create-client-first>',
                        redirectUri: form.redirectUris.split('\n')[0] ?? '',
                        scopes: 'openid profile email',
                      },
                      null,
                      2,
                    ),
                  )
                }
                type="button"
                variant="secondary"
              >
                <Copy data-icon="inline-start" /> {tt('Copy details')}{' '}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </ResourcePage>
  )
}

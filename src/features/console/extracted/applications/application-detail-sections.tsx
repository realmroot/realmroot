import type { OrganizationResponse } from '@shared/api/authorization'
import { Link } from '@tanstack/react-router'
import {
  type ApplicationOidcClaims,
  type ApplicationResponse,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConsoleActionBar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Save,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  tt,
  useEffect,
  useState,
} from '../../console-shared'
import { clientTypeLabel, MutationError, StatusBadge, SwitchRow } from '../../helpers/helpers-dialogs'
import { applicationAudienceLabel, ownerLabel } from '../../helpers/ownership-access-controls'

type OidcClaimDestination = keyof ApplicationOidcClaims
type OidcClaimKey = keyof ApplicationOidcClaims[OidcClaimDestination]

const oidcClaimDestinations: Array<{ key: OidcClaimDestination; label: string }> = [
  { key: 'accessToken', label: 'Access token' },
  { key: 'idToken', label: 'ID token' },
  { key: 'userInfo', label: 'UserInfo' },
]

const oidcClaimControls: Array<{ key: OidcClaimKey; label: string }> = [
  { key: 'organizationId', label: 'organization ID' },
  { key: 'organizationName', label: 'organization name' },
  { key: 'authorization', label: 'authorization claim' },
  { key: 'groups', label: 'groups' },
  { key: 'roles', label: 'roles' },
  { key: 'scopes', label: 'OAuth scopes' },
]

export function ApplicationOidcClaimsForm({
  claims,
  error,
  onSave,
  pending,
}: {
  claims: ApplicationOidcClaims
  error: unknown
  onSave: (claims: ApplicationOidcClaims) => void
  pending: boolean
}) {
  const [form, setForm] = useState<ApplicationOidcClaims>(claims)
  useEffect(() => setForm(claims), [claims])

  return (
    <Card className="applicationSettingsPanel">
      <CardHeader>
        <CardTitle>{tt('OIDC claims')}</CardTitle>
        <CardDescription>
          {tt('Choose which organization and authorization claims are emitted to each token destination.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="formStack"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(form)
          }}
        >
          <div className="oidcClaimsGrid">
            {oidcClaimDestinations.map((destination) => (
              <div className="oidcClaimsColumn" key={destination.key}>
                <h3 className="text-xs font-semibold uppercase leading-5 text-muted-foreground">
                  {tt(destination.label)}
                </h3>
                <div className="grid gap-2">
                  {oidcClaimControls.map((control) => (
                    <SwitchRow
                      checked={form[destination.key][control.key] === true}
                      disabled={pending}
                      key={`${destination.key}-${control.key}`}
                      label={tt(`${destination.label} ${control.label}`)}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          [destination.key]: {
                            ...current[destination.key],
                            [control.key]: checked,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <ConsoleActionBar>
            <Button disabled={pending} type="submit">
              <Save data-icon="inline-start" /> {tt('Save OIDC claims')}{' '}
            </Button>
            <Button disabled={pending} onClick={() => setForm(claims)} type="reset" variant="secondary">
              {' '}
              {tt('Discard')}{' '}
            </Button>
          </ConsoleActionBar>
          <MutationError error={error} />
        </form>
      </CardContent>
    </Card>
  )
}
export function ApplicationsTableContent({
  applications,
  emptyDescription,
  emptyTitle,
  hasApplications,
  onToggleDisabled,
  organizations,
  context,
}: {
  applications: ApplicationResponse[]
  emptyDescription: string
  emptyTitle: string
  hasApplications: boolean
  onToggleDisabled: (application: ApplicationResponse) => void
  organizations: OrganizationResponse[]
  context?: string
}) {
  if (!applications.length && hasApplications) {
    return (
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[27%]">{tt('Application')}</TableHead>
            <TableHead className="w-[19%]">{tt('Type')}</TableHead>
            <TableHead className="w-[15%]">{tt('Audience')}</TableHead>
            <TableHead className="w-[10%]">{tt('Status')}</TableHead>
            <TableHead className="w-[16%]">{tt('Owner')}</TableHead>
            <TableHead className="w-[11%]">{tt('Updated')}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmptyRow colSpan={7} description={emptyDescription} title={emptyTitle} />
        </TableBody>
      </Table>
    )
  }
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[27%]">{tt('Application')}</TableHead>
          <TableHead className="w-[19%]">{tt('Type')}</TableHead>
          <TableHead className="w-[15%]">{tt('Audience')}</TableHead>
          <TableHead className="w-[10%]">{tt('Status')}</TableHead>
          <TableHead className="w-[16%]">{tt('Owner')}</TableHead>
          <TableHead className="w-[11%]">{tt('Updated')}</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.length ? (
          applications.map((application) => (
            <TableRow key={application.id}>
              <TableCell className="min-w-0">
                <Link
                  className="block truncate font-medium hover:underline"
                  params={{ applicationId: application.id }}
                  search={context ? { context } : {}}
                  to="/console/applications/$applicationId"
                >
                  {application.name}
                </Link>
                <div className="truncate font-mono text-xs text-muted-foreground" title={application.clientId}>
                  {application.clientId}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{clientTypeLabel(application.clientType)}</Badge>
                </div>
                <div
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={application.allowedGrantTypes.join(', ')}
                >
                  {application.allowedGrantTypes.join(', ')}
                </div>
              </TableCell>
              <TableCell>{applicationAudienceLabel(application.audience.mode)}</TableCell>
              <TableCell>
                <StatusBadge active={!application.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              </TableCell>
              <TableCell className="truncate" title={ownerLabel(application.ownerOrganizationId, organizations)}>
                {ownerLabel(application.ownerOrganizationId, organizations)}
              </TableCell>
              <TableCell>{new Date(application.updatedAt).toLocaleDateString()}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger aria-label={`Actions for ${application.name}`}>
                    <MoreHorizontal data-icon="inline-start" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => onToggleDisabled(application)}>
                        {application.disabled ? 'Enable' : 'Disable'}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableEmptyRow
            colSpan={7}
            description={tt('Create your first OIDC client to connect an application to hosted authentication.')}
            title={tt('No applications yet')}
          />
        )}
      </TableBody>
    </Table>
  )
}

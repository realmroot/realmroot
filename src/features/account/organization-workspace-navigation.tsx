import { Link, useNavigate } from '@tanstack/react-router'
import {
  Activity,
  AppWindow,
  Bot,
  Building2,
  Check,
  ChevronsUpDown,
  Network,
  Server,
  Settings,
  ShieldCheck,
  UsersRound,
  Webhook,
} from 'lucide-react'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setActiveAccountOrganization } from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { accountQueryKeys, useAccountMutation, useAccountOrganizations } from './queries'

const workspaceNavigation = [
  {
    label: 'Workspace',
    items: [
      { segment: 'overview', label: 'Overview', icon: Building2 },
      { segment: 'members', label: 'Members', icon: UsersRound },
      { segment: 'teams', label: 'Teams', icon: Network },
      { segment: 'activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    label: 'Build',
    items: [
      { segment: 'applications', label: 'Applications', icon: AppWindow },
      { segment: 'resource-servers', label: 'Resource servers', icon: Server },
      { segment: 'webhooks/endpoints', activeSegment: 'webhooks', label: 'Webhooks', icon: Webhook },
    ],
  },
  {
    label: 'Access & authority',
    items: [
      { segment: 'agents', label: 'Agents', icon: Bot },
      { segment: 'roles', label: 'Roles', icon: ShieldCheck },
    ],
  },
  {
    items: [{ segment: 'settings', label: 'Settings', icon: Settings }],
  },
] as const

export function OrganizationWorkspaceNavigation({
  onNavigate,
  organizationId,
  pathname,
}: {
  onNavigate?: () => void
  organizationId: string
  pathname: string
}) {
  const navigate = useNavigate()
  const organizationsQuery = useAccountOrganizations()
  const mutate = useAccountMutation()
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const organizations = organizationsQuery.data ?? []
  const organization = organizations.find((candidate) => candidate.id === organizationId)

  async function switchOrganization(nextOrganizationId: string) {
    if (nextOrganizationId === organizationId || switchingId) return
    setSwitchingId(nextOrganizationId)
    let failed = false
    await mutate('Active organization changed.', () => setActiveAccountOrganization(nextOrganizationId), {
      invalidate: [accountQueryKeys.profile, accountQueryKeys.organizationContext],
      onError: () => {
        failed = true
      },
    })
    setSwitchingId(null)
    if (failed) return
    onNavigate?.()
    await navigate({ params: { organizationId: nextOrganizationId }, to: '/organizations/$organizationId/overview' })
  }

  return (
    <aside className="accountSidebar organizationWorkspaceSidebar">
      <div className="organizationWorkspacePicker">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={tt('Switch organization')}
              className="organizationWorkspacePickerTrigger"
              disabled={organizationsQuery.isLoading}
              type="button"
            >
              <span aria-hidden="true" className="organizationWorkspaceMark">
                {(organization?.name ?? organizationId).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <strong>
                  {organization?.name ?? (organizationsQuery.isLoading ? tt('Loading…') : organizationId)}
                </strong>
                <small>{tt('Organization workspace')}</small>
              </span>
              <ChevronsUpDown aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="organizationWorkspaceMenu">
            <DropdownMenuLabel>{tt('Switch organization')}</DropdownMenuLabel>
            {organizations.map((candidate) => (
              <DropdownMenuItem
                className="organizationWorkspaceMenuItem"
                disabled={switchingId !== null}
                key={candidate.id}
                onSelect={() => void switchOrganization(candidate.id)}
              >
                <span aria-hidden="true" className="organizationWorkspaceMenuMark">
                  {candidate.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <strong>{candidate.name}</strong>
                  <small>{candidate.slug}</small>
                </span>
                {candidate.id === organizationId ? <Check aria-label={tt('Current organization')} /> : null}
              </DropdownMenuItem>
            ))}
            {organizationsQuery.error ? (
              <p className="px-2 py-1.5 text-xs text-destructive" role="alert">
                {organizationsQuery.error.message}
              </p>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link onClick={onNavigate} to="/organizations">
                <Network />
                {tt('All organizations')}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav aria-label={tt('Organization workspace')} className="accountNav organizationWorkspaceNav">
        {workspaceNavigation.map((group, index) => (
          <div className="accountNavGroup" key={'label' in group ? group.label : index}>
            {'label' in group && group.label ? <p>{tt(group.label)}</p> : null}
            {group.items.map((item) => {
              const activeSegment = 'activeSegment' in item ? item.activeSegment : item.segment
              const active = isWorkspaceSectionActive(pathname, organizationId, activeSegment)
              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={cn('accountNavItem', active && 'is-active')}
                  key={item.segment}
                  onClick={onNavigate}
                  params={{ organizationId }}
                  to={`/organizations/$organizationId/${item.segment}`}
                >
                  <item.icon aria-hidden="true" />
                  <span>{tt(item.label)}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="organizationWorkspaceFooter">
        <Link className="accountNavItem" onClick={onNavigate} to="/organizations">
          <Network aria-hidden="true" />
          <span>{tt('All organizations')}</span>
        </Link>
      </div>
    </aside>
  )
}

function isWorkspaceSectionActive(pathname: string, organizationId: string, segment: string) {
  const base = `/organizations/${organizationId}/${segment}`
  return pathname === base || pathname.startsWith(`${base}/`)
}

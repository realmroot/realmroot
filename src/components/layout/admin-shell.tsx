import type { AccountProfileResponse } from '@shared/api/account'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  AppWindow,
  BellRing,
  Bot,
  Boxes,
  Building2,
  Cable,
  Check,
  ChevronRight,
  Code2,
  Fingerprint,
  Gauge,
  KeyRound,
  Languages,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  Network,
  Settings,
  Shield,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getAccountProfile } from '@/lib/api/account'
import { signOut } from '@/lib/auth-client'
import { normalizeLanguage, tt } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

type ConsoleNavItem = {
  href: string
  icon: typeof Gauge
  labelKey: string
  match?: string
}
type ConsoleNavGroup = {
  items: ConsoleNavItem[]
  labelKey: string
}
const adminNavGroups: ConsoleNavGroup[] = [
  {
    labelKey: 'console.overview',
    items: [
      {
        href: '/console',
        labelKey: 'console.dashboard',
        icon: Gauge,
      },
    ],
  },
  {
    labelKey: 'console.authentication',
    items: [
      {
        href: '/console/applications',
        labelKey: 'common.applications',
        icon: AppWindow,
      },
      {
        href: '/console/sign-in-experience/sign-up-and-sign-in',
        labelKey: 'console.signInAccount',
        icon: Fingerprint,
        match: '/console/sign-in-experience',
      },
      {
        href: '/console/mfa',
        labelKey: 'Multi-factor auth',
        icon: ShieldCheck,
      },
      {
        href: '/console/connectors',
        labelKey: 'Connectors',
        icon: Cable,
        match: '/console/connectors',
      },
      {
        href: '/console/security/captcha',
        labelKey: 'common.security',
        icon: Shield,
        match: '/console/security',
      },
    ],
  },
  {
    labelKey: 'console.authorization',
    items: [
      {
        href: '/console/api-resources',
        labelKey: 'API resources',
        icon: KeyRound,
      },
      {
        href: '/console/roles',
        labelKey: 'Roles',
        icon: LockKeyhole,
      },
      {
        href: '/console/organization-template/organization-roles',
        labelKey: 'Organization template',
        icon: Network,
        match: '/console/organization-template',
      },
    ],
  },
  {
    labelKey: 'common.users',
    items: [
      {
        href: '/console/organizations',
        labelKey: 'Organizations',
        icon: Building2,
      },
      {
        href: '/console/users',
        labelKey: 'User management',
        icon: UsersRound,
      },
      {
        href: '/console/agents',
        labelKey: 'Delegated agents',
        icon: Bot,
      },
    ],
  },
  {
    labelKey: 'console.developer',
    items: [
      {
        href: '/console/customize-jwt',
        labelKey: 'Custom JWT',
        icon: Code2,
      },
      {
        href: '/console/webhooks/endpoints',
        labelKey: 'Webhooks',
        icon: BellRing,
        match: '/console/webhooks',
      },
    ],
  },
  {
    labelKey: 'console.tenant',
    items: [
      {
        href: '/console/tenant-settings/oidc-configs',
        labelKey: 'Settings',
        icon: Settings,
        match: '/console/tenant-settings',
      },
    ],
  },
]
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [profile, setProfile] = useState<AccountProfileResponse['user'] | null>(null)
  useEffect(() => {
    let active = true
    void getAccountProfile().then((response) => {
      if (active) setProfile(response.user)
    })
    return () => {
      active = false
    }
  }, [])
  return (
    <div className="consoleShell text-foreground">
      <header className="consoleTopbar">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? tt('console.closeNavigation') : tt('Open console navigation')}
              className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
              onClick={() => setMobileNavOpen((open) => !open)}
              type="button"
            >
              {mobileNavOpen ? (
                <X aria-hidden="true" className="size-4" />
              ) : (
                <Menu aria-hidden="true" className="size-4" />
              )}
            </button>
            <ConsoleBrand />
          </div>
          <div className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm lg:flex">
              <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{tt('common.default')}</span>
            </div>
            <ConsoleAccountMenu profile={profile} />
          </div>
        </div>
      </header>
      {mobileNavOpen ? (
        <div className="consoleMobileNavLayer lg:hidden">
          <button
            aria-label={tt('console.dismissNavigation')}
            className="absolute inset-0 cursor-default bg-transparent"
            onClick={() => setMobileNavOpen(false)}
            type="button"
          />
          <aside className="relative h-full w-[min(320px,calc(100vw-32px))] border-r border-border bg-background shadow-lg">
            <nav
              aria-label={tt('console.mobileNavigation')}
              className="consoleNavScroll h-full overflow-y-auto px-3 py-4"
            >
              <AdminNavigation onNavigate={() => setMobileNavOpen(false)} pathname={pathname} />
            </nav>
          </aside>
        </div>
      ) : null}
      <div className="consoleBody lg:flex">
        <aside className="consoleRail hidden lg:flex">
          <nav className="consoleNavScroll min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-label={tt('console.console')}>
            <AdminNavigation pathname={pathname} />
          </nav>
        </aside>
        <main className="consoleMain">
          <div className="consoleContent">{children}</div>
        </main>
      </div>
    </div>
  )
}
function ConsoleBrand() {
  return (
    <a className="consoleBrand flex h-10 min-w-0 items-center gap-3 text-foreground" href="/console">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
        {' '}
        {tt('F')}{' '}
      </span>
      <span className="consoleBrandName truncate text-sm font-semibold leading-none">{tt('FlareAuth')}</span>
      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
      <span className="consoleBrandContext truncate text-sm font-medium text-muted-foreground">
        {tt('common.adminConsole')}
      </span>
    </a>
  )
}
function ConsoleAccountMenu({ profile }: { profile: AccountProfileResponse['user'] | null }) {
  async function onSignOut() {
    await signOut()
    window.location.href = '/sign-in'
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={tt('console.accountMenu')} className="size-9 rounded-full p-0">
        <ConsoleAvatar profile={profile} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 bg-popover p-2 text-popover-foreground">
        <DropdownMenuGroup>
          <ConsoleAccountSummary profile={profile} />
          <a className="consoleAccountMenuItem" href="/profile" role="menuitem">
            <UserRound aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="truncate">{tt('common.profile')}</span>
          </a>
          <hr className="my-1 border-border" />
          <ConsolePreferenceMenu />
          <hr className="my-1 border-border" />
          <DropdownMenuItem
            className="consoleAccountMenuItem consoleAccountMenuItemDanger"
            onClick={() => void onSignOut()}
          >
            <LogOut aria-hidden="true" className="size-4" />
            <span className="truncate">{tt('common.signOut')}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
function ConsoleAccountSummary({ profile }: { profile: AccountProfileResponse['user'] | null }) {
  return (
    <div className="consoleAccountMenuSummary">
      <ConsoleAvatar profile={profile} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {profile?.displayName || profile?.name || tt('common.profile')}
        </p>
        {profile?.email ? <p className="truncate text-xs text-muted-foreground">{profile.email}</p> : null}
      </div>
    </div>
  )
}
function ConsolePreferenceMenu() {
  const { i18n } = useTranslation()
  const { setTheme, theme } = useTheme()
  const language = normalizeLanguage(i18n.language)
  return (
    <>
      <ConsolePreferenceSubmenu
        icon={<Languages aria-hidden="true" className="size-4" />}
        label={tt('common.language')}
        options={[
          {
            active: language === 'en',
            label: tt('EN'),
            onSelect: () => void i18n.changeLanguage('en'),
          },
          {
            active: language === 'zh',
            label: '中文',
            onSelect: () => void i18n.changeLanguage('zh'),
          },
        ]}
      />
      <ConsolePreferenceSubmenu
        icon={
          theme === 'dark' ? (
            <Moon aria-hidden="true" className="size-4" />
          ) : (
            <Sun aria-hidden="true" className="size-4" />
          )
        }
        label={tt('common.theme')}
        options={[
          {
            active: theme === 'light',
            label: tt('common.light'),
            onSelect: () => setTheme('light'),
          },
          {
            active: theme === 'dark',
            label: tt('common.dark'),
            onSelect: () => setTheme('dark'),
          },
        ]}
      />
    </>
  )
}
function ConsolePreferenceSubmenu({
  icon,
  label,
  options,
}: {
  icon: ReactNode
  label: string
  options: Array<{ active: boolean; label: string; onSelect: () => void }>
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="consoleAccountMenuItem consoleSubmenuTrigger">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="consoleSubmenuContent bg-popover text-popover-foreground">
        {options.map((option) => (
          <DropdownMenuItem
            className="consoleSubmenuItem"
            key={option.label}
            onClick={option.onSelect}
            role="menuitemradio"
            aria-checked={option.active}
          >
            <Check aria-hidden="true" className={cn('size-4', !option.active && 'invisible')} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
function ConsoleAvatar({ profile }: { profile: AccountProfileResponse['user'] | null }) {
  const fallback = (profile?.displayName || profile?.email || 'A').trim().slice(0, 1).toUpperCase()
  if (profile?.image) {
    return <img alt="" className="size-8 rounded-full object-cover" src={profile.image} width="32" height="32" />
  }
  return (
    <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {fallback}
    </span>
  )
}
function AdminNavigation({ onNavigate, pathname }: { onNavigate?: () => void; pathname: string }) {
  return (
    <div className="grid gap-3">
      {adminNavGroups.map((group) => (
        <div className="grid gap-1" key={group.labelKey}>
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
            {tt(group.labelKey)}
          </p>
          {group.items.map((item) => {
            const active = isActive(pathname, getItemMatchPath(item))
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  active && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                )}
                key={item.href}
                onClick={onNavigate}
                to={item.href}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{tt(item.labelKey)}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </div>
  )
}
function getItemMatchPath(item: ConsoleNavItem) {
  return item.match ?? item.href
}
function isActive(pathname: string, href: string) {
  if (href === '/console') return pathname === href || pathname === '/console/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

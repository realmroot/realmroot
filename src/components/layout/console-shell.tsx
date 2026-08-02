import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import type { OrganizationResponse } from '@shared/api/authorization'
import { Link, useNavigate, useRouterState, useSearch } from '@tanstack/react-router'
import {
  AppWindow,
  Bot,
  Building2,
  Cable,
  Check,
  Code2,
  Fingerprint,
  Gauge,
  HelpCircle,
  Languages,
  Link2,
  LogOut,
  Menu,
  Moon,
  Palette,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
  Webhook,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RealmrootWordmark } from '@/components/realmroot-brand'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { UserProfile } from '@/features/account/types'
import { signOut } from '@/lib/auth-client'
import { ConsoleScopeProvider } from '@/lib/console-context'
import { normalizeLanguage, tt } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

type ConsoleContext = 'realm' | 'organization'

type ConsoleNavItem = {
  href: string
  icon: typeof Gauge
  label: string
  activePaths?: string[]
  contexts?: ConsoleContext[]
}

type ConsoleNavGroup = {
  items: ConsoleNavItem[]
  label?: string
  contexts?: ConsoleContext[]
}

const consoleNavGroups: ConsoleNavGroup[] = [
  {
    items: [{ href: '/console', label: 'Dashboard', icon: Gauge, activePaths: ['/console', '/console/dashboard'] }],
  },
  {
    label: 'Identity',
    items: [
      { href: '/console/users', label: 'Users', icon: UsersRound },
      { href: '/console/agents', label: 'Agents', icon: Bot },
      { href: '/console/organizations', label: 'Organizations', icon: Building2, contexts: ['realm'] },
    ],
  },
  {
    label: 'Develop',
    items: [
      { href: '/console/applications', label: 'Applications', icon: AppWindow },
      { href: '/console/api-resources', label: 'Resource servers', icon: Server },
      {
        href: '/console/webhooks/endpoints',
        label: 'Webhooks',
        icon: Webhook,
        activePaths: ['/console/webhooks'],
      },
    ],
  },
  {
    label: 'Authorization',
    items: [
      { href: '/console/roles', label: 'Roles', icon: ShieldCheck },
      { href: '/console/role-assignments', label: 'Role assignments', icon: Link2 },
    ],
  },
  {
    label: 'Authentication',
    contexts: ['realm'],
    items: [
      { href: '/console/connectors', label: 'Identity providers', icon: Cable },
      {
        href: '/console/sign-in-experience/sign-in',
        label: 'Sign-in & registration',
        icon: Fingerprint,
        activePaths: ['/console/sign-in-experience/sign-in', '/console/sign-in-experience/sign-up-and-sign-in'],
      },
      {
        href: '/console/security/sign-in',
        label: 'Security policies',
        icon: Shield,
        activePaths: ['/console/security'],
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        href: '/console/sign-in-experience/theme',
        label: 'Experience',
        icon: Palette,
        contexts: ['realm'],
        activePaths: [
          '/console/sign-in-experience/theme',
          '/console/sign-in-experience/assets',
          '/console/sign-in-experience/legal',
          '/console/sign-in-experience/branding',
          '/console/sign-in-experience/content',
          '/console/sign-in-experience/account-center',
        ],
      },
      {
        href: '/console/tenant-settings/general',
        label: 'Settings',
        icon: Settings,
        contexts: ['realm'],
        activePaths: ['/console/tenant-settings'],
      },
    ],
  },
]

const consoleUtilities = [
  { href: '/api/openapi.json', label: 'Management API', icon: Code2 },
  { href: 'https://github.com/realmroot/realmroot/tree/main/docs', label: 'Help & documentation', icon: HelpCircle },
]

export function ConsoleShell({
  access,
  children,
  organizations,
  profile,
}: {
  access: DeveloperConsoleAccessResponse
  children: ReactNode
  organizations: OrganizationResponse[]
  profile: UserProfile
}) {
  const navigate = useNavigate()
  const { context: requestedContext } = useSearch({ from: '/console' })
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [scope, setScope] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('context')
    if (requested && organizations.some((organization) => organization.id === requested)) return requested
    return access.realmOperator ? 'realm' : (organizations[0]?.id ?? 'realm')
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null)
  const context: ConsoleContext = scope === 'realm' ? 'realm' : 'organization'
  const groups = visibleGroups(context)

  useEffect(() => {
    if (requestedContext && organizations.some((organization) => organization.id === requestedContext)) {
      setScope(requestedContext)
      return
    }
    setScope(access.realmOperator ? 'realm' : (organizations[0]?.id ?? 'realm'))
  }, [access.realmOperator, organizations, requestedContext])

  function changeScope(value: string) {
    setScope(value)
    void navigate({ replace: true, search: value === 'realm' ? {} : { context: value }, to: pathname })
  }

  function changeMobileNavigation(open: boolean) {
    setMobileNavOpen(open)
    if (!open) window.setTimeout(() => mobileNavTriggerRef.current?.focus(), 0)
  }

  return (
    <ConsoleScopeProvider
      value={{ organizationId: context === 'organization' ? scope : undefined, realmOperator: access.realmOperator }}
    >
      <div className="consoleShell text-foreground">
        <a className="skipLink" href="#console-content">
          {tt('Skip to content')}
        </a>
        <header className="consoleTopbar">
          <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                aria-expanded={mobileNavOpen}
                aria-label={mobileNavOpen ? tt('Close navigation') : tt('Open navigation')}
                className="lg:hidden"
                onClick={() => setMobileNavOpen((open) => !open)}
                ref={mobileNavTriggerRef}
                size="icon"
                type="button"
                variant="ghost"
              >
                {mobileNavOpen ? <X /> : <Menu />}
              </Button>
              <Link
                aria-label={tt('Realmroot Console home')}
                search={scope === 'realm' ? {} : { context: scope }}
                to="/console"
              >
                <RealmrootWordmark context={tt('Console')} />
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button aria-label={tt('Search Console')} onClick={() => setSearchOpen(true)} size="icon" variant="ghost">
                <Search />
              </Button>
              <label className="consoleContextSwitcher hidden sm:grid" htmlFor="console-context">
                <span>{tt('Context')}</span>
                <NativeSelect
                  aria-label={tt('Console context')}
                  id="console-context"
                  name="console-context"
                  onChange={(event) => changeScope(event.target.value)}
                  value={scope}
                >
                  {access.realmOperator ? <NativeSelectOption value="realm">{tt('Realm')}</NativeSelectOption> : null}
                  {organizations.map((organization) => (
                    <NativeSelectOption key={organization.id} value={organization.id}>
                      {organization.displayName ?? organization.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <ConsoleAccountMenu profile={profile} />
            </div>
          </div>
        </header>
        <Sheet onOpenChange={changeMobileNavigation} open={mobileNavOpen}>
          <SheetContent
            className="w-[min(292px,calc(100vw-32px))] gap-0 bg-sidebar p-0 lg:hidden"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              mobileNavTriggerRef.current?.focus()
            }}
            side="left"
          >
            <SheetTitle className="sr-only">{tt('Console navigation')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('Navigate Realmroot Console')}</SheetDescription>
            <div className="flex h-16 shrink-0 items-center border-b px-4">
              <RealmrootWordmark context={tt('Console')} />
            </div>
            <aside className="flex min-h-0 flex-1 flex-col">
              <ConsoleNavigation
                groups={groups}
                onNavigate={() => setMobileNavOpen(false)}
                pathname={pathname}
                scope={scope}
              />
            </aside>
          </SheetContent>
        </Sheet>
        <div className="consoleBody lg:flex">
          <aside className="consoleRail hidden lg:flex">
            <ConsoleNavigation groups={groups} pathname={pathname} scope={scope} />
          </aside>
          <main className="consoleMain" id="console-content" tabIndex={-1}>
            <div className="consoleContent">{children}</div>
          </main>
        </div>
        {searchOpen ? <ConsoleSearch groups={groups} onOpenChange={setSearchOpen} open scope={scope} /> : null}
      </div>
    </ConsoleScopeProvider>
  )
}

function ConsoleNavigation({
  groups,
  onNavigate,
  pathname,
  scope,
}: {
  groups: ConsoleNavGroup[]
  onNavigate?: () => void
  pathname: string
  scope: string
}) {
  return (
    <>
      <nav aria-label={tt('Console')} className="consoleNavScroll min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="grid gap-4">
          {groups.map((group, index) => (
            <div className="grid gap-1" key={group.label ?? index}>
              {group.label ? <p className="consoleNavGroupLabel">{tt(group.label)}</p> : null}
              {group.items.map((item) => {
                const active = isActive(pathname, item)
                return (
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn('consoleNavItem', active && 'is-active')}
                    key={item.href}
                    onClick={onNavigate}
                    search={scope === 'realm' ? {} : { context: scope }}
                    to={item.href}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{tt(item.label)}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </nav>
      <div className="consoleNavFooter">
        {consoleUtilities.map((item) => (
          <a
            className="consoleNavItem"
            href={item.href}
            key={item.label}
            rel="noreferrer"
            target={item.href.startsWith('http') ? '_blank' : undefined}
          >
            <item.icon aria-hidden="true" />
            <span>{tt(item.label)}</span>
          </a>
        ))}
      </div>
    </>
  )
}

function ConsoleSearch({
  groups,
  onOpenChange,
  open,
  scope,
}: {
  groups: ConsoleNavGroup[]
  onOpenChange: (open: boolean) => void
  open: boolean
  scope: string
}) {
  const navigate = useNavigate()
  return (
    <CommandDialog
      description={tt('Search Console pages and settings.')}
      onOpenChange={onOpenChange}
      open={open}
      title={tt('Search Console')}
    >
      <Command>
        <CommandInput placeholder={tt('Search Console…')} />
        <CommandList>
          <CommandEmpty>{tt('No matching pages.')}</CommandEmpty>
          {groups.map((group, index) => (
            <CommandGroup heading={group.label ? tt(group.label) : tt('General')} key={group.label ?? index}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.href}
                  onSelect={() => {
                    onOpenChange(false)
                    void navigate({ search: scope === 'realm' ? {} : { context: scope }, to: item.href })
                  }}
                  value={item.label}
                >
                  <item.icon />
                  {tt(item.label)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function ConsoleAccountMenu({ profile }: { profile: UserProfile }) {
  async function onSignOut() {
    await signOut()
    window.location.href = '/auth/sign-in'
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={tt('Account menu')} className="rounded-full" size="icon" variant="ghost">
          <Avatar>
            {profile.image ? <AvatarImage alt="" src={profile.image} /> : null}
            <AvatarFallback className="bg-primary/10 font-semibold text-primary">
              {profileInitials(profile.displayName)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold">{profile.displayName}</span>
          <span className="block text-xs font-normal text-muted-foreground">{profile.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/profile">
              <UserRound />
              {tt('Account Center')}
            </Link>
          </DropdownMenuItem>
          <ConsolePreferenceMenu />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void onSignOut()} variant="destructive">
          <LogOut />
          {tt('Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConsolePreferenceMenu() {
  const { i18n } = useTranslation()
  const { setTheme, theme } = useTheme()
  const language = normalizeLanguage(i18n.language)
  return (
    <>
      <ConsolePreferenceSubmenu
        icon={<Languages />}
        label={tt('Language')}
        options={[
          { active: language === 'en', label: 'English', onSelect: () => void i18n.changeLanguage('en') },
          { active: language === 'zh', label: '简体中文', onSelect: () => void i18n.changeLanguage('zh') },
        ]}
      />
      <ConsolePreferenceSubmenu
        icon={theme === 'dark' ? <Moon /> : <Sun />}
        label={tt('Theme')}
        options={[
          { active: theme === 'light', label: tt('Light'), onSelect: () => setTheme('light') },
          { active: theme === 'dark', label: tt('Dark'), onSelect: () => setTheme('dark') },
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
      <DropdownMenuSubTrigger>
        {icon}
        <span>{label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {options.map((option) => (
          <DropdownMenuItem
            aria-checked={option.active}
            key={option.label}
            onClick={option.onSelect}
            role="menuitemradio"
          >
            <Check className={cn(!option.active && 'invisible')} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function visibleGroups(context: ConsoleContext) {
  return consoleNavGroups
    .filter((group) => !group.contexts || group.contexts.includes(context))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.contexts || item.contexts.includes(context)),
    }))
    .filter((group) => group.items.length > 0)
}

function isActive(pathname: string, item: ConsoleNavItem) {
  const activePaths = item.activePaths ?? [item.href]
  return activePaths.some((path) => pathname === path || (path !== '/console' && pathname.startsWith(`${path}/`)))
}

function profileInitials(displayName: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

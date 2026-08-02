import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AppWindow,
  Bot,
  Building2,
  Check,
  Gauge,
  Languages,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  Shield,
  Sun,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { brandingStyle } from '@/components/layout/auth-layout'
import { RealmrootWordmark } from '@/components/realmroot-brand'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Status } from '@/components/ui/status'
import { signOut } from '@/lib/auth-client'
import { normalizeLanguage, tt } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { AccountCenterSection, defaultAccountCenterSettings } from './settings'
import type { UserProfile } from './types'

type AccountCenterSettings = typeof defaultAccountCenterSettings

const accountNavGroups = [
  {
    label: 'Your account',
    items: [
      { section: 'overview' as const, href: '/account', label: 'Overview', icon: Gauge },
      { section: 'profile' as const, href: '/profile', label: 'Profile', icon: UserRound },
      { section: 'security' as const, href: '/security', label: 'Sign-in & security', icon: Shield },
    ],
  },
  {
    label: 'Access & authority',
    items: [
      { section: 'applications' as const, href: '/account/applications', label: 'Applications', icon: AppWindow },
      { section: 'agents' as const, href: '/account/agents', label: 'Agents', icon: Bot },
      { section: 'organizations' as const, href: '/account/organizations', label: 'Organizations', icon: Building2 },
    ],
  },
]

export function AccountPageShell({
  access,
  accountCenter,
  children,
  config,
  profile,
  section,
}: {
  access: DeveloperConsoleAccessResponse
  accountCenter: AccountCenterSettings
  children: ReactNode
  config: Parameters<typeof brandingStyle>[0]
  profile: UserProfile | null
  section: AccountCenterSection
}) {
  void accountCenter
  const navigate = useNavigate()
  const [navigationOpen, setNavigationOpen] = useState(false)
  const navigationTriggerRef = useRef<HTMLButtonElement>(null)

  function changeNavigation(open: boolean) {
    setNavigationOpen(open)
    if (!open) window.setTimeout(() => navigationTriggerRef.current?.focus(), 0)
  }

  async function signOutFromAccount() {
    try {
      await signOut()
      toast.success(tt('Signed out'))
      await navigate({ to: '/auth/sign-in' })
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? tt(mutationError.message) : tt('Account update failed.'))
    }
  }

  return (
    <main className="accountShell" style={brandingStyle(config)}>
      <a className="skipLink" href="#account-content">
        {tt('Skip to content')}
      </a>
      <header className="accountProductTopbar">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            aria-label={tt('Open Account Center navigation')}
            className="accountMobileMenu"
            onClick={() => setNavigationOpen(true)}
            ref={navigationTriggerRef}
            size="icon"
            variant="ghost"
          >
            <Menu />
          </Button>
          <Link aria-label={tt('Account Center home')} to="/account">
            <RealmrootWordmark context={tt('Account Center')} />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <div className="accountDeploymentContext hidden sm:flex">
            <Shield aria-hidden="true" />
            <span>identity.acme.dev</span>
          </div>
          {profile ? (
            <AccountUserMenu access={access} profile={profile} onSignOut={() => void signOutFromAccount()} />
          ) : null}
        </div>
      </header>
      <div className="accountShellLayout">
        <AccountSidebar access={access} section={section} />
        <section className="accountContent" id="account-content" tabIndex={-1}>
          {children}
        </section>
      </div>
      <Sheet onOpenChange={changeNavigation} open={navigationOpen}>
        <SheetContent
          className="accountMobileNavSheet w-72 p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            navigationTriggerRef.current?.focus()
          }}
          side="left"
        >
          <SheetHeader className="border-b">
            <SheetTitle>{tt('Account Center')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('Navigate Account Center pages.')}</SheetDescription>
          </SheetHeader>
          <AccountSidebar access={access} onNavigate={() => setNavigationOpen(false)} section={section} />
        </SheetContent>
      </Sheet>
    </main>
  )
}

export function AccountPageLoading({ config }: { config: Parameters<typeof brandingStyle>[0] }) {
  return (
    <main className="accountShell" style={brandingStyle(config)}>
      <header className="accountProductTopbar">
        <RealmrootWordmark context={tt('Account Center')} />
      </header>
      <section className="accountStandaloneState">
        <Status>
          <LoaderCircle className="spin" size={18} />
          {tt('Loading account center')}
        </Status>
      </section>
    </main>
  )
}

export function AccountPageError({
  config,
  message,
}: {
  config: Parameters<typeof brandingStyle>[0]
  message: string
}) {
  return (
    <main className="accountShell" style={brandingStyle(config)}>
      <header className="accountProductTopbar">
        <RealmrootWordmark context={tt('Account Center')} />
      </header>
      <section className="accountStandaloneState">
        <Status tone="error">{message}</Status>
      </section>
    </main>
  )
}

function AccountSidebar({
  access,
  onNavigate,
  section,
}: {
  access: DeveloperConsoleAccessResponse
  onNavigate?: () => void
  section: AccountCenterSection
}) {
  return (
    <aside className="accountSidebar">
      <nav aria-label={tt('Account Center')} className="accountNav">
        {accountNavGroups.map((group) => (
          <div className="accountNavGroup" key={group.label}>
            <p>{tt(group.label)}</p>
            {group.items
              .filter((item) => item.section !== 'organizations' || access.showOrganizations)
              .map((item) => (
                <Link
                  aria-current={section === item.section ? 'page' : undefined}
                  className={cn('accountNavItem', section === item.section && 'is-active')}
                  key={item.section}
                  onClick={onNavigate}
                  to={item.href}
                >
                  <item.icon aria-hidden="true" />
                  <span>{tt(item.label)}</span>
                </Link>
              ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

function AccountUserMenu({
  access,
  profile,
  onSignOut,
}: {
  access: DeveloperConsoleAccessResponse
  profile: UserProfile
  onSignOut: () => void
}) {
  const { i18n } = useTranslation()
  const { setTheme, theme } = useTheme()
  const language = normalizeLanguage(i18n.language)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={tt('Account menu')} className="rounded-full" size="icon" variant="ghost">
          <Avatar>
            {profile.image ? <AvatarImage alt="" src={profile.image} /> : null}
            <AvatarFallback className="bg-primary/10 font-semibold text-primary">
              {profile.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-semibold">{profile.displayName}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{profile.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {access.realmOperator || access.consoleOrganizations.length ? (
          <DropdownMenuItem asChild>
            <Link to="/console">
              <LayoutDashboard />
              <span>{tt('Console')}</span>
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages />
            <span>{tt('Language')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <AccountPreferenceSubmenu
              options={[
                { label: 'English', active: language === 'en', onSelect: () => void i18n.changeLanguage('en') },
                { label: '简体中文', active: language === 'zh', onSelect: () => void i18n.changeLanguage('zh') },
              ]}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === 'dark' ? <Moon /> : <Sun />}
            <span>{tt('Theme')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <AccountPreferenceSubmenu
              options={[
                { label: tt('Light'), active: theme === 'light', onSelect: () => setTheme('light') },
                { label: tt('Dark'), active: theme === 'dark', onSelect: () => setTheme('dark') },
              ]}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} variant="destructive">
          <LogOut />
          <span>{tt('Sign out')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AccountPreferenceSubmenu({
  options,
}: {
  options: Array<{ label: string; active: boolean; onSelect: () => void }>
}) {
  return (
    <>
      {options.map((option) => (
        <DropdownMenuItem
          aria-checked={option.active}
          key={option.label}
          onClick={option.onSelect}
          role="menuitemradio"
        >
          <Check className={cn(!option.active && 'invisible')} />
          <span>{option.label}</span>
        </DropdownMenuItem>
      ))}
    </>
  )
}

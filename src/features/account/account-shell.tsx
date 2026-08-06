import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AppWindow,
  Bot,
  Building2,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Shield,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { toast } from 'sonner'
import { brandingStyle } from '@/components/layout/auth-layout'
import { ProductAccountMenu } from '@/components/product-account-menu'
import { RealmrootWordmark } from '@/components/realmroot-brand'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Status } from '@/components/ui/status'
import { signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AccountCenterSection, defaultAccountCenterSettings } from './settings'
import type { UserProfile } from './types'

type AccountCenterSettings = typeof defaultAccountCenterSettings

const accountNavGroups = [
  {
    label: 'Your account',
    items: [
      { section: 'overview' as const, href: '/', label: 'Overview', icon: Gauge },
      { section: 'profile' as const, href: '/profile', label: 'Profile', icon: UserRound },
      { section: 'security' as const, href: '/security', label: 'Sign-in & security', icon: Shield },
    ],
  },
  {
    label: 'Access & authority',
    items: [
      { section: 'applications' as const, href: '/applications', label: 'Applications', icon: AppWindow },
      { section: 'agents' as const, href: '/agents', label: 'Agents', icon: Bot },
      { section: 'organizations' as const, href: '/organizations', label: 'Organizations', icon: Building2 },
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
          <Link aria-label={tt('Account Center home')} to="/">
            <RealmrootWordmark context={tt('Account Center')} />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            aria-label={tt('Help & documentation')}
            className="hidden sm:inline-flex"
            size="icon"
            variant="ghost"
          >
            <a href="https://github.com/realmroot/realmroot/tree/main/docs" rel="noreferrer" target="_blank">
              <HelpCircle />
            </a>
          </Button>
          {profile ? (
            <ProductAccountMenu
              onSignOut={() => void signOutFromAccount()}
              primaryAction={
                access.realmOperator ? { icon: LayoutDashboard, label: 'Console', to: '/console' } : undefined
              }
              profile={profile}
            />
          ) : null}
        </div>
      </header>
      <div className="accountShellLayout">
        <AccountSidebar access={access} profile={profile} section={section} />
        <section
          className={cn('accountContent', (section === 'profile' || section === 'security') && 'is-settings')}
          id="account-content"
          tabIndex={-1}
        >
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
          <AccountSidebar
            access={access}
            onNavigate={() => setNavigationOpen(false)}
            profile={profile}
            section={section}
          />
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
  profile,
  section,
}: {
  access: DeveloperConsoleAccessResponse
  onNavigate?: () => void
  profile: UserProfile | null
  section: AccountCenterSection
}) {
  return (
    <aside className="accountSidebar">
      {profile ? (
        <div className="accountSidebarIdentity">
          <Avatar className="size-11">
            {profile.image ? <AvatarImage alt="" src={profile.image} /> : null}
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {profile.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <strong>{profile.displayName}</strong>
            <span>{profile.email}</span>
          </div>
        </div>
      ) : null}
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

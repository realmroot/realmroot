import { Link } from '@tanstack/react-router'
import { Check, Languages, LogOut, type LucideIcon, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
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
import { normalizeLanguage, tt } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export type ProductAccountMenuAction = {
  icon: LucideIcon
  label: string
  to: string
}

export type ProductAccountMenuProfile = {
  displayName: string
  email: string
  image?: string | null
  username?: string | null
}

export function ProductAccountMenu({
  onSignOut,
  primaryAction,
  profile,
}: {
  onSignOut: () => void
  primaryAction?: ProductAccountMenuAction
  profile: ProductAccountMenuProfile
}) {
  const { i18n } = useTranslation()
  const { setTheme, theme } = useTheme()
  const language = normalizeLanguage(i18n.language)
  const initials = profileInitials(profile.displayName)
  const profileIdentity = (
    <>
      <Avatar className="accountMenuHeaderAvatar">
        {profile.image ? <AvatarImage alt="" src={profile.image} /> : null}
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
      </Avatar>
      <div>
        <strong>{profile.displayName}</strong>
        <span>{profile.email}</span>
      </div>
    </>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={tt('Account menu')} className="accountAvatarMenuTrigger" size="icon" variant="ghost">
          <Avatar>
            {profile.image ? <AvatarImage alt="" src={profile.image} /> : null}
            <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="accountUserMenu" sideOffset={8}>
        {profile.username ? (
          <DropdownMenuItem asChild className="accountUserMenuHeader">
            <Link
              aria-label={tt('View public profile for {{name}}', { name: profile.displayName })}
              params={{ username: profile.username }}
              to="/u/$username"
            >
              {profileIdentity}
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuLabel className="accountUserMenuHeader">{profileIdentity}</DropdownMenuLabel>
        )}
        {primaryAction ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="accountMenuItem">
                <Link to={primaryAction.to}>
                  <primaryAction.icon />
                  <span>{tt(primaryAction.label)}</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="accountMenuSeparator" />
          </>
        ) : null}
        <DropdownMenuGroup className="grid gap-1">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="accountMenuItem accountSubmenuTrigger">
              <span className="accountSubmenuTriggerLabel">
                <Languages />
                <span>{tt('Language')}</span>
              </span>
              <span className="accountSubmenuValue">{language === 'zh' ? '简体中文' : 'English'}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="accountSubmenuContent" sideOffset={6}>
              <ProductPreferenceOptions
                options={[
                  { label: 'English', active: language === 'en', onSelect: () => void i18n.changeLanguage('en') },
                  { label: '简体中文', active: language === 'zh', onSelect: () => void i18n.changeLanguage('zh') },
                ]}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="accountMenuItem accountSubmenuTrigger">
              <span className="accountSubmenuTriggerLabel">
                {theme === 'dark' ? <Moon /> : <Sun />}
                <span>{tt('Theme')}</span>
              </span>
              <span className="accountSubmenuValue">{theme === 'dark' ? tt('Dark') : tt('Light')}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="accountSubmenuContent" sideOffset={6}>
              <ProductPreferenceOptions
                options={[
                  { label: tt('Light'), active: theme === 'light', onSelect: () => setTheme('light') },
                  { label: tt('Dark'), active: theme === 'dark', onSelect: () => setTheme('dark') },
                ]}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="accountMenuSeparator" />
        <DropdownMenuItem className="accountMenuItem" onClick={onSignOut} variant="destructive">
          <LogOut />
          <span>{tt('Sign out')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProductPreferenceOptions({
  options,
}: {
  options: Array<{ label: string; active: boolean; onSelect: () => void }>
}) {
  return options.map((option) => (
    <DropdownMenuItem
      aria-checked={option.active}
      className="accountMenuItem accountSubmenuItem"
      key={option.label}
      onClick={option.onSelect}
      role="menuitemradio"
    >
      <Check className={cn(!option.active && 'invisible')} />
      <span>{option.label}</span>
    </DropdownMenuItem>
  ))
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

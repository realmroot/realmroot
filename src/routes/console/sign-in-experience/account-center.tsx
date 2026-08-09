import { createFileRoute } from '@tanstack/react-router'
import { AccountCenterSettingsPage } from '@/features/console/extracted/branding-content/account-center-settings'

export const Route = createFileRoute('/console/sign-in-experience/account-center')({
  component: AccountCenterSettingsPage,
})

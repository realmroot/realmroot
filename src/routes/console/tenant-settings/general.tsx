import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/features/console/extracted/deployment-misc/deployment'

export const Route = createFileRoute('/console/tenant-settings/general')({ component: GeneralSettingsRoute })

function GeneralSettingsRoute() {
  return <SettingsPage section="general" />
}

import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/features/console/extracted/deployment-misc/deployment'

export const Route = createFileRoute('/console/tenant-settings/developer')({ component: DeveloperSettingsRoute })

function DeveloperSettingsRoute() {
  return <SettingsPage section="developer" />
}

import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/features/console/extracted/deployment-misc/deployment'

export const Route = createFileRoute('/console/tenant-settings/deployment')({ component: DeploymentSettingsRoute })

function DeploymentSettingsRoute() {
  return <SettingsPage section="deployment" />
}

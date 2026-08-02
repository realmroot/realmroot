import { createFileRoute } from '@tanstack/react-router'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'

export const Route = createFileRoute('/console/sign-in-experience/sign-in')({ component: SignInSettingsRoute })

function SignInSettingsRoute() {
  return <SignInSettingsPage />
}

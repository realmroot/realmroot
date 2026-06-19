import { createFileRoute } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { DeviceVerification } from '@/features/auth/device-authorization'
import { useConfigz } from '@/features/auth/hooks'
import { tt } from '@/lib/i18n'

export const Route = createFileRoute('/device/')({
  component: DeviceEntryRoute,
})

function DeviceEntryRoute() {
  const { data: config } = useConfigz()
  const userCode = new URLSearchParams(window.location.search).get('user_code') ?? ''

  return (
    <AuthLayout
      config={config}
      description={tt('Authorize a signed-in browser session for a native client.')}
      eyebrow="Device login"
      icon={<KeyRound aria-hidden="true" size={28} />}
      title={tt('Device login')}
    >
      <DeviceVerification mode="entry" userCode={userCode} />
    </AuthLayout>
  )
}

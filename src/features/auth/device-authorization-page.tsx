import { KeyRound } from 'lucide-react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { useConfigz } from '@/features/auth/hooks'
import { tt } from '@/lib/i18n'
import { DeviceVerification } from './device-authorization'

export function DeviceAuthorizationPage({ userCode }: { userCode: string }) {
  const { data: config } = useConfigz()

  return (
    <AuthLayout
      config={config}
      description={tt('Enter the code shown by the requesting device, then review its access.')}
      eyebrow="Device authorization"
      icon={<KeyRound aria-hidden="true" size={28} />}
      title={tt('Connect a device')}
    >
      <DeviceVerification userCode={userCode} />
    </AuthLayout>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { DeviceVerification } from '@/features/auth/device-authorization'
import { useConfigz } from '@/features/auth/hooks'
import { tt } from '@/lib/i18n'

export const Route = createFileRoute('/_approval/device/approve')({ component: DeviceApprovalRoute })

function DeviceApprovalRoute() {
  const { data: config } = useConfigz()
  const userCode = new URLSearchParams(window.location.search).get('user_code') ?? ''

  return (
    <AuthLayout
      backHref="/device"
      config={config}
      description={tt('Review the code before approving account access.')}
      eyebrow="Device login"
      icon={<ShieldCheck aria-hidden="true" size={28} />}
      title={tt('Approve device')}
    >
      <DeviceVerification mode="approval" userCode={userCode} />
    </AuthLayout>
  )
}

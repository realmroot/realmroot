import type { ApplicationResponse } from '@shared/api/applications'
import { MutationError } from '@/features/management/dialogs'
import { AssetUploadControl } from '@/features/management/forms'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, SettingRow, tt } from '@/features/management/shared'

export function ApplicationBrandingCard({
  application,
  error,
  errorMessage,
  onLogo,
}: {
  application: ApplicationResponse
  error: unknown
  errorMessage?: string | null
  onLogo: (file: File) => void
}) {
  return (
    <Card className="applicationSettingsPanel">
      <CardHeader>
        <CardTitle>{tt('Application branding')}</CardTitle>
        <CardDescription>{tt('Logo and display values shown in application and consent surfaces.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <AssetUploadControl
          accept="image/png,image/jpeg,image/webp"
          label={`Upload logo for ${application.name}`}
          onFile={onLogo}
          previewUrl={application.iconUrl}
        />
        <SettingRow label={tt('Display name')} value={application.name} />
        <SettingRow label={tt('Homepage URL')} value={application.homepageUrl ?? 'Not set'} />
        <MutationError error={error} />
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

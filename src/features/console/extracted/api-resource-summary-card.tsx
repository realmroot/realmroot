import { Card, CardContent, CardDescription, CardHeader, CardTitle, SettingRow, tt } from '../console-shared'
import { formatDate } from '../helpers/helpers-utils'

export function ApiResourceSummaryCard({
  resource,
}: {
  resource: {
    id: string
    identifier: string
    audience: string
    enabled: boolean
    createdAt: string | Date
    updatedAt: string | Date
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Resource summary')}</CardTitle>
        <CardDescription>{tt('Read-only API authorization context.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('Resource ID')} value={resource.id} />
        <SettingRow label={tt('Identifier')} value={resource.identifier} />
        <SettingRow label={tt('Audience')} value={resource.audience} />
        <SettingRow label={tt('Status')} value={resource.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label={tt('Scope authority')} value="Business OpenAPI" />
        <SettingRow label={tt('Updated')} value={formatDate(resource.updatedAt)} />
      </CardContent>
    </Card>
  )
}

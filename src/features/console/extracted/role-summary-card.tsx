import { Card, CardContent, CardDescription, CardHeader, CardTitle, SettingRow, tt } from '../console-shared'

export function RoleSummaryCard({
  scopeCount,
  role,
}: {
  scopeCount: number
  role: {
    id: string
    key: string
    name: string
    system: boolean
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Role summary')}</CardTitle>
        <CardDescription>{tt('Read-only role scope and eligibility context.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('Role ID')} value={role.id} />
        <SettingRow label={tt('Key')} value={role.key} />
        <SettingRow label={tt('Type')} value={role.system ? 'System role' : 'Custom role'} />
        <SettingRow label={tt('Availability')} value={tt('Realm-wide')} />
        <SettingRow label={tt('Referenced scopes')} value={String(scopeCount)} />
      </CardContent>
    </Card>
  )
}

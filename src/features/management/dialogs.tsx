import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { consoleQueryKeys, listConnectors } from '@/lib/api/management'
import {
  AlertCircle,
  type ApplicationResponse,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Copy,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  emptyConnectorsResponse,
  Field,
  type ReactNode,
  RefreshCw,
  SettingRow,
  Switch,
  TextArea,
  tt,
  useQuery,
  useState,
} from './shared'

export function SummaryRow({ meta, status, title }: { meta: string; status: ReactNode; title: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      {status}
    </div>
  )
}
export function PolicyCard({
  framed = true,
  rows,
  title,
}: {
  framed?: boolean
  rows: Array<[string, string]>
  title: string
}) {
  const content = (
    <>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map(([label, value]) => (
          <SettingRow key={label} label={label} value={value} />
        ))}
      </CardContent>
    </>
  )
  if (!framed) return <div>{content}</div>
  return <Card>{content}</Card>
}
export function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      toast.error(tt('Unable to copy to the clipboard.'))
    }
  }

  return (
    <Button onClick={() => void copy()} type="button" variant="secondary">
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? tt('Copied') : label}
    </Button>
  )
}
export function SecretDisclosureDialog({
  clientId,
  clientSecret,
  onClose,
  open,
}: {
  clientId: string | null
  clientSecret: string | null
  onClose: () => void
  open: boolean
}) {
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Copy client secret')}</DialogTitle>
          <DialogDescription>
            {' '}
            {tt(
              'This secret is shown once. Store it in your application secret manager before closing this dialog.',
            )}{' '}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 p-4">
          <SettingRow label={tt('Client ID')} value={clientId ?? ''} />
          <SettingRow label={tt('Client secret')} value={clientSecret ?? ''} />
          <CopyButton label={tt('Copy secret')} value={clientSecret ?? ''} />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            {' '}
            {tt('Done')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function DeleteApplicationDialog({
  applicationName,
  error,
  onClose,
  onConfirm,
  open,
  pending,
}: {
  applicationName: string
  error: unknown
  onClose: () => void
  onConfirm: () => void
  open: boolean
  pending: boolean
}) {
  return (
    <DestructiveConfirmation
      confirmLabel={tt('Delete application')}
      description={
        <>
          {tt('Deleting')} {applicationName}{' '}
          {tt('removes the OIDC client and stops existing integrations from authenticating.')}
        </>
      }
      error={<MutationError error={error} />}
      onClose={onClose}
      onConfirm={onConfirm}
      open={open}
      pending={pending}
      title={tt('Delete application')}
    />
  )
}
export function BanUserDialog({
  error,
  onClose,
  onConfirm,
  open,
  pending,
  userName,
}: {
  error: unknown
  onClose: () => void
  onConfirm: (reason: string) => void
  open: boolean
  pending: boolean
  userName: string
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Ban user')}</DialogTitle>
          <DialogDescription>
            {tt('Banning')} {userName} {tt('blocks sign-in until an admin unbans the account.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-4">
          <Field label={tt('Reason')}>
            <TextArea name="reason" onChange={(event) => setReason(event.target.value)} value={reason} />
          </Field>
          <MutationError error={error} />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            {' '}
            {tt('Cancel')}{' '}
          </Button>
          <Button disabled={pending} onClick={() => onConfirm(reason)} type="button" variant="destructive">
            {' '}
            {tt('Ban user')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function DangerConfirmDialog({
  actionLabel,
  description,
  error,
  onClose,
  onConfirm,
  open,
  pending,
  title,
}: {
  actionLabel: string
  description: string
  error: unknown
  onClose: () => void
  onConfirm: () => void
  open: boolean
  pending: boolean
  title: string
}) {
  return (
    <DestructiveConfirmation
      confirmLabel={actionLabel}
      description={description}
      error={<MutationError error={error} />}
      onClose={onClose}
      onConfirm={onConfirm}
      open={open}
      pending={pending}
      title={title}
    />
  )
}
export function MutationError({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      role="alert"
    >
      {error instanceof Error ? tt(error.message) : tt('Request failed.')}
    </div>
  )
}
export function SwitchRow({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={disabled ? undefined : onCheckedChange}
      />
    </div>
  )
}
export function clientConfig(application: ApplicationResponse, clientSecret: string | null) {
  return JSON.stringify(
    {
      issuer: application.oidc.issuer,
      discoveryUrl: `${application.oidc.issuer}/.well-known/openid-configuration`,
      clientId: application.clientId,
      redirectUris: listItems(application.redirectUris),
      postLogoutRedirectUris: listItems(application.postLogoutRedirectUris),
      corsOrigins: listItems(application.corsOrigins),
      scopes: application.oidcScopes.join(' '),
      tokenEndpointAuthMethod: application.tokenEndpointAuthMethod,
      customData: application.customData,
      ...(clientSecret
        ? {
            clientSecret,
          }
        : {}),
    },
    null,
    2,
  )
}
export function listItems(value: readonly string[] | undefined) {
  return Array.isArray(value) ? [...value] : []
}
export function listValue(value: readonly string[] | undefined, separator: string) {
  return listItems(value).join(separator)
}
export function clientTypeLabel(value: ApplicationResponse['clientType']) {
  if (value === 'public_spa') return 'Public SPA'
  if (value === 'public_native') return 'Public native'
  return 'Confidential web'
}
export function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean
  activeLabel: string
  inactiveLabel: string
}) {
  return <Badge variant={active ? 'secondary' : 'outline'}>{active ? activeLabel : inactiveLabel}</Badge>
}
export function useConnectorPreviewProviders() {
  const query = useQuery({
    queryKey: consoleQueryKeys.connectors,
    queryFn: listConnectors,
    placeholderData: emptyConnectorsResponse,
  })
  const connectors = Array.isArray(query.data?.connectors) ? query.data.connectors : []
  return {
    ...query,
    providers: connectors
      .filter((connector) => connector.enabled)
      .map((connector) => ({
        displayName: connector.displayName,
        icon: connector.providerType === 'social' ? connector.providerId : 'oauth',
        providerId: connector.providerId,
        slug: connector.slug,
      })),
  }
}
export function LoadingState({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <RefreshCw className="spin" data-icon="inline-start" />
        {label}
      </CardContent>
    </Card>
  )
}
export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle data-icon="inline-start" />
          {error.message}
        </div>
        {onRetry ? (
          <Button onClick={onRetry} variant="secondary">
            {' '}
            {tt('Retry')}{' '}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

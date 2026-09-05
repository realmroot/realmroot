export {
  HostedAuthPreview,
  hostedAuthMode,
  localizedHostedCopy,
  PreviewBrandMark,
  passwordSignupEnabled,
  previewSignInAction,
} from './hosted-auth-preview'

import { CopyButton, SwitchRow } from './dialogs'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type ReactNode,
  RefreshCw,
  SettingRow,
  TableCell,
  TableRow,
  Trash2,
  tt,
  type WebhookEndpoint,
  type WebhookRequest,
} from './shared'

export function WebhookEndpointRow({
  endpoint,
  onDelete,
  onRotate,
  onToggle,
}: {
  endpoint: WebhookEndpoint
  onDelete: (id: string) => void
  onRotate: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{endpoint.url}</div>
        <div className="text-xs text-muted-foreground">{endpoint.id}</div>
      </TableCell>
      <TableCell>{endpoint.events.join(', ')}</TableCell>
      <TableCell>
        <SwitchRow
          checked={endpoint.enabled}
          label={endpoint.enabled ? tt('Enabled') : tt('Disabled')}
          onCheckedChange={(checked) => onToggle(endpoint.id, checked)}
        />
      </TableCell>
      <TableCell>{endpoint.secretPrefix}…</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onRotate(endpoint.id)} type="button" variant="secondary">
            <RefreshCw data-icon="inline-start" /> {tt('Rotate secret')}{' '}
          </Button>
          <Button onClick={() => onDelete(endpoint.id)} type="button" variant="destructive">
            <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
export function WebhookSecretDisclosureDialog({ onClose, secret }: { onClose: () => void; secret: string | null }) {
  return (
    <Dialog open={Boolean(secret)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Signing secret')}</DialogTitle>
          <DialogDescription>{tt('Copy this secret now. It is shown only once.')}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="grid gap-3 p-4">
            <code className="break-all rounded-md border border-border bg-muted p-3 text-sm">{secret}</code>
            <CopyButton label={tt('Copy secret')} value={secret} />
          </div>
        ) : null}
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button">
            {' '}
            {tt('Done')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function WebhookRequestDialog({ onClose, request }: { onClose: () => void; request: WebhookRequest | null }) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={Boolean(request)}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tt('Webhook request')}</DialogTitle>
          <DialogDescription>{request?.id}</DialogDescription>
        </DialogHeader>
        {request ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-3">
              <SettingRow label={tt('Endpoint')} value={request.endpointUrl} />
              <SettingRow label={tt('Event')} value={request.event} />
              <SettingRow label={tt('Status')} value={request.status} />
              <SettingRow label={tt('Attempts')} value={String(request.attemptCount)} />
              <SettingRow
                label={tt('HTTP status')}
                value={request.httpStatus ? String(request.httpStatus) : 'Pending'}
              />
              {request.error ? <SettingRow label={tt('Error')} value={request.error} /> : null}
              {request.requestBody ? <PayloadBlock label={tt('Request body')} value={request.requestBody} /> : null}
              {request.responseBody ? <PayloadBlock label={tt('Response body')} value={request.responseBody} /> : null}
            </div>
          </div>
        ) : null}
        <DialogFooter className="m-0 shrink-0">
          <Button onClick={onClose} type="button">
            {' '}
            {tt('Close')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function PayloadBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{value}</pre>
    </div>
  )
}
export function SignInExperienceEditorLayout({ settings }: { settings: ReactNode }) {
  return <div className="signInExperienceSettings">{settings}</div>
}
export function SignInExperiencePreviewPanel({ children }: { children: ReactNode }) {
  return (
    <aside className="signInExperiencePreviewPanel" aria-label={tt('Hosted authentication preview')}>
      {children}
    </aside>
  )
}

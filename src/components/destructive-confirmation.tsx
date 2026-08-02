import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export function DestructiveConfirmation({
  cancelLabel = 'Cancel',
  confirmLabel,
  description,
  error,
  onClose,
  onConfirm,
  open,
  pending = false,
  title,
}: {
  cancelLabel?: string
  confirmLabel: string
  description: ReactNode
  error?: ReactNode
  onClose: () => void
  onConfirm: () => void
  open: boolean
  pending?: boolean
  title: ReactNode
}) {
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose()
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="destructive">
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

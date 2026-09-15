import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Button } from '@/components/ui/button'
import { deleteOwnAccount } from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { AccountRow } from './account-page'

export function DeleteAccountPanel() {
  const queryClient = useQueryClient()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)

  async function erase() {
    setPending(true)
    setError(null)
    try {
      await deleteOwnAccount()
    } catch (cause) {
      setError(cause instanceof Error ? tt(cause.message) : tt('Unable to delete account.'))
      setPending(false)
      return
    }
    queryClient.clear()
    setDeleted(true)
    setPending(false)
    setOpen(false)
    // Navigate away from all private UI. The server has already invalidated credentials.
    window.location.replace('/auth/account-deleted')
  }

  return (
    <>
      <AccountRow
        action={
          <Button
            ref={triggerRef}
            variant="destructive"
            disabled={deleted}
            onClick={() => {
              setError(null)
              setOpen(true)
            }}
          >
            {tt('Delete account')}
          </Button>
        }
        description={tt(
          'Permanently delete your Realmroot account. This cannot be undone. Your personal Agents and access will also be revoked.',
        )}
        label={tt('Delete account')}
        value={tt('Permanent')}
      />
      <DestructiveConfirmation
        returnFocusRef={triggerRef}
        open={open}
        pending={pending}
        title={tt('Permanently delete account?')}
        description={tt(
          'You will no longer be able to sign in to this account. Your profile and sign-in credentials will be deleted, and your personal Agents and access will be revoked. This cannot be undone. Organizations you belong to and their shared resources will not be deleted.',
        )}
        confirmLabel={pending ? tt('Deleting…') : tt('Permanently delete account')}
        cancelLabel={tt('Cancel')}
        onClose={() => setOpen(false)}
        onConfirm={() => void erase()}
        error={
          error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null
        }
      />
    </>
  )
}

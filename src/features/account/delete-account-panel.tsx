import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Button } from '@/components/ui/button'
import { deleteOwnAccount } from '@/lib/api/account'
import { signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { PanelTitle, SettingsAction } from './primitives'

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

  async function reauthenticate() {
    setPending(true)
    setError(null)
    try {
      await signOut()
      queryClient.clear()
      window.location.assign('/auth/sign-in?return_to=%2Fsecurity')
    } catch (cause) {
      setError(cause instanceof Error ? tt(cause.message) : tt('Unable to sign out.'))
      setPending(false)
    }
  }

  return (
    <section className="settingsPanel">
      <PanelTitle
        icon={<Trash2 />}
        title={tt('Delete account')}
        description={tt('Permanently delete your Realmroot account. This cannot be undone.')}
      />
      <SettingsAction
        icon={<Trash2 />}
        title={tt('Delete account')}
        meta={tt('Your personal Agents and access will also be revoked.')}
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
      />
      <DestructiveConfirmation
        returnFocusRef={triggerRef}
        open={open}
        pending={pending}
        title={tt('Permanently delete account?')}
        description={tt(
          'Your profile and sign-in credentials will be erased, your Agents and personal access revoked, and you will be signed out. Necessary identity history is retained. External cleanup may take additional time. Organizations and their shared resources are not deleted. Sign in within the last five minutes before continuing.',
        )}
        confirmLabel={pending ? tt('Deleting…') : tt('Permanently delete account')}
        cancelLabel={tt('Cancel')}
        onClose={() => setOpen(false)}
        onConfirm={() => void erase()}
        error={
          <>
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <Button variant="outline" disabled={pending} onClick={() => void reauthenticate()}>
              {tt('Sign in again')}
            </Button>
          </>
        }
      />
    </section>
  )
}

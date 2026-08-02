import { Fingerprint } from 'lucide-react'
import { useState } from 'react'
import { Field, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { disableTotp, startTotpEnrollment, verifyTotp } from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { accountQueryKeys } from './queries'
import type { MutationHandler, SecurityState } from './types'
import { enrollPasskey, readTotpEnrollment, type TotpEnrollmentDisplay, withTotpQrCode } from './utils'

export function TotpDialogs({
  code,
  dialog,
  mfaRequired,
  mutate,
  password,
  profileEmail,
  setCode,
  setDialog,
  setPassword,
  setTotpEnrollment,
  totpEnrollment,
}: {
  code: string
  dialog: 'mfa-enroll' | 'mfa-verify' | 'mfa-disable' | 'passkey' | null
  mfaRequired: boolean
  mutate: MutationHandler
  password: string
  profileEmail: string
  setCode: (value: string) => void
  setDialog: (dialog: 'mfa-enroll' | 'mfa-verify' | 'mfa-disable' | 'passkey' | null) => void
  setPassword: (value: string) => void
  setTotpEnrollment: (value: TotpEnrollmentDisplay | null) => void
  totpEnrollment: TotpEnrollmentDisplay | null
}) {
  return (
    <>
      <TotpEnrollDialog
        code={code}
        dialog={dialog}
        mutate={mutate}
        password={password}
        profileEmail={profileEmail}
        setCode={setCode}
        setDialog={setDialog}
        setPassword={setPassword}
        setTotpEnrollment={setTotpEnrollment}
        totpEnrollment={totpEnrollment}
      />
      <TotpVerifyDialog code={code} dialog={dialog} mutate={mutate} setCode={setCode} setDialog={setDialog} />
      <TotpDisableDialog
        dialog={dialog}
        mfaRequired={mfaRequired}
        mutate={mutate}
        password={password}
        profileEmail={profileEmail}
        setDialog={setDialog}
        setPassword={setPassword}
      />
    </>
  )
}

function TotpEnrollDialog({
  code,
  dialog,
  mutate,
  password,
  profileEmail,
  setCode,
  setDialog,
  setPassword,
  setTotpEnrollment,
  totpEnrollment,
}: {
  code: string
  dialog: string | null
  mutate: MutationHandler
  password: string
  profileEmail: string
  setCode: (value: string) => void
  setDialog: (dialog: null) => void
  setPassword: (value: string) => void
  setTotpEnrollment: (value: TotpEnrollmentDisplay | null) => void
  totpEnrollment: TotpEnrollmentDisplay | null
}) {
  const [verificationComplete, setVerificationComplete] = useState(false)

  function reset() {
    setCode('')
    setPassword('')
    setTotpEnrollment(null)
    setVerificationComplete(false)
    setDialog(null)
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) reset()
      }}
      open={dialog === 'mfa-enroll'}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (verificationComplete) {
              reset()
              return
            }
            if (totpEnrollment) {
              const result = await mutate('MFA enabled.', () => verifyTotp({ code, trustDevice: true }), {
                invalidate: [accountQueryKeys.security],
              })
              if (result) {
                setCode('')
                setPassword('')
                setVerificationComplete(true)
              }
              return
            }
            await mutate('TOTP enrollment started.', async () => {
              const enrollment = await startTotpEnrollment({ password })
              setTotpEnrollment(await withTotpQrCode(readTotpEnrollment(enrollment)))
              return enrollment
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt(verificationComplete ? 'Save backup codes' : 'Enroll authenticator app')}</DialogTitle>
            <DialogDescription>
              {tt(
                verificationComplete
                  ? 'Keep these recovery codes somewhere safe before finishing setup.'
                  : totpEnrollment
                    ? 'Scan the QR code, then enter the current code from your authenticator app.'
                    : 'Confirm your password to begin authenticator app setup.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            {verificationComplete && totpEnrollment ? (
              <TotpBackupCodes backupCodes={totpEnrollment.backupCodes} />
            ) : totpEnrollment ? (
              <>
                <TotpEnrollmentDetails enrollment={totpEnrollment} />
                <Field label={tt('Authenticator code')}>
                  <TextInput
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    name="totp-code"
                    onChange={(event) => setCode(event.target.value)}
                    value={code}
                  />
                </Field>
              </>
            ) : (
              <>
                <input autoComplete="username" hidden name="username" readOnly type="text" value={profileEmail} />
                <Field label={tt('Password')}>
                  <TextInput
                    autoComplete="current-password"
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    value={password}
                  />
                </Field>
              </>
            )}
          </div>
          <DialogFooter>
            {verificationComplete ? (
              <Button type="submit">{tt('Done')}</Button>
            ) : (
              <>
                <Button onClick={reset} type="button" variant="secondary">
                  {tt('Cancel')}
                </Button>
                <Button type="submit" variant="secondary">
                  {totpEnrollment ? tt('Verify code') : tt('Enroll authenticator app')}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TotpVerifyDialog({
  code,
  dialog,
  mutate,
  setCode,
  setDialog,
}: {
  code: string
  dialog: string | null
  mutate: MutationHandler
  setCode: (value: string) => void
  setDialog: (dialog: null) => void
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setCode('')
          setDialog(null)
        }
      }}
      open={dialog === 'mfa-verify'}
    >
      <DialogContent>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const result = await mutate('MFA challenge verified.', () => verifyTotp({ code, trustDevice: true }))
            if (result) setDialog(null)
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt('Verify authenticator code')}</DialogTitle>
            <DialogDescription>{tt('Enter the current code from your authenticator app.')}</DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            <Field label={tt('Authenticator code')}>
              <TextInput
                autoComplete="one-time-code"
                inputMode="numeric"
                name="totp-code"
                onChange={(event) => setCode(event.target.value)}
                value={code}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setDialog(null)} type="button" variant="secondary">
              {tt('Cancel')}
            </Button>
            <Button type="submit" variant="secondary">
              {tt('Verify code')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TotpDisableDialog({
  dialog,
  mfaRequired,
  mutate,
  password,
  profileEmail,
  setDialog,
  setPassword,
}: {
  dialog: string | null
  mfaRequired: boolean
  mutate: MutationHandler
  password: string
  profileEmail: string
  setDialog: (dialog: null) => void
  setPassword: (value: string) => void
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setPassword('')
          setDialog(null)
        }
      }}
      open={dialog === 'mfa-disable'}
    >
      <DialogContent>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const result = await mutate('MFA disabled.', () => disableTotp({ password }), {
              invalidate: [accountQueryKeys.security],
            })
            if (result) {
              setPassword('')
              setDialog(null)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt('Disable MFA')}</DialogTitle>
            <DialogDescription>{tt('Confirm your password to remove authenticator app protection.')}</DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            <input autoComplete="username" hidden name="username" readOnly type="text" value={profileEmail} />
            <Field label={tt('Password')}>
              <TextInput
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setDialog(null)} type="button" variant="secondary">
              {tt('Cancel')}
            </Button>
            <Button disabled={mfaRequired} type="submit" variant="destructive">
              {tt('Disable authenticator app')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PasskeyDialog({
  dialog,
  mutate,
  passkeyName,
  security,
  setDialog,
  setPasskeyName,
}: {
  dialog: string | null
  mutate: MutationHandler
  passkeyName: string
  security: SecurityState | null
  setDialog: (dialog: null) => void
  setPasskeyName: (value: string) => void
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setPasskeyName('')
          setDialog(null)
        }
      }}
      open={dialog === 'passkey'}
    >
      <DialogContent>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const result = await mutate('Passkey enrolled.', () => enrollPasskey(passkeyName), {
              invalidate: [accountQueryKeys.passkeys, accountQueryKeys.security],
            })
            if (result) {
              setPasskeyName('')
              setDialog(null)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt('Add passkey')}</DialogTitle>
            <DialogDescription>{tt('Create a hardware-backed passkey for this account.')}</DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            <Field label={tt('Passkey name')}>
              <TextInput
                autoComplete="webauthn"
                name="passkey-name"
                onChange={(event) => setPasskeyName(event.target.value)}
                value={passkeyName}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setDialog(null)} type="button" variant="secondary">
              {tt('Cancel')}
            </Button>
            <Button disabled={!security?.policy.passkeys.enabled} type="submit" variant="secondary">
              <Fingerprint size={18} /> {tt('Add passkey')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TotpEnrollmentDetails({ enrollment }: { enrollment: TotpEnrollmentDisplay }) {
  return (
    <div className="setupPanel">
      <h3>{tt('Authenticator setup')}</h3>
      {enrollment.qrCode ? (
        <img
          className="setupQr mx-auto"
          src={enrollment.qrCode}
          alt="Authenticator app QR code"
          width="168"
          height="168"
        />
      ) : null}
      {enrollment.secret ? (
        <p>
          <strong>{tt('Manual setup key')}</strong>
          <code>{enrollment.secret}</code>
        </p>
      ) : enrollment.otpAuthUri ? (
        <p>
          <strong>{tt('Enrollment URI')}</strong>
          <code>{enrollment.otpAuthUri}</code>
        </p>
      ) : null}
    </div>
  )
}

function TotpBackupCodes({ backupCodes }: { backupCodes: string[] }) {
  return (
    <div className="setupPanel mt-0">
      <strong>{tt('Backup codes')}</strong>
      <p>{tt('Each code can be used once if you lose access to your authenticator app.')}</p>
      <div className="backupCodeGrid">
        {backupCodes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
    </div>
  )
}

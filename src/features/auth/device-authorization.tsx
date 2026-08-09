import { CheckCircle2, XCircle } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Field, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { approveDeviceCode, denyDeviceCode, verifyDeviceCode } from '@/lib/auth-client'
import { deduplicateRequest } from '@/lib/request-deduplication'

type DeviceVerificationProps = {
  userCode?: string
  mode: 'entry' | 'approval'
}

export function DeviceVerification({ mode, userCode: initialUserCode = '' }: DeviceVerificationProps) {
  const [userCode, setUserCode] = useState(initialUserCode)
  const [verifiedCode, setVerifiedCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const normalizedCode = useMemo(() => normalizeUserCode(userCode), [userCode])

  useEffect(() => {
    if (mode !== 'approval' || !initialUserCode) return
    let canceled = false
    setSubmitting(true)
    setError(null)
    deduplicateRequest(`device-code:${initialUserCode}`, () => verifyDeviceCode({ userCode: initialUserCode }))
      .then((response) => {
        if (canceled) return
        setVerifiedCode(response.user_code)
      })
      .catch((verifyError) => {
        if (canceled) return
        setVerifiedCode(null)
        setError(verifyError instanceof Error ? verifyError.message : 'Device code is invalid or expired.')
      })
      .finally(() => {
        if (!canceled) setSubmitting(false)
      })
    return () => {
      canceled = true
    }
  }, [initialUserCode, mode])

  function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!normalizedCode) return
    window.location.assign(`/device/approve?user_code=${encodeURIComponent(normalizedCode)}`)
  }

  async function decide(decision: 'approve' | 'deny') {
    const code = verifiedCode ?? normalizedCode
    if (!code) return
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      if (decision === 'approve') {
        await approveDeviceCode({ userCode: code })
        setMessage('Device approved.')
      } else {
        await denyDeviceCode({ userCode: code })
        setMessage('Device denied.')
      }
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Unable to update device access.')
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'entry') {
    return (
      <form className="grid gap-4" onSubmit={submitEntry}>
        <Field label="Device code">
          <TextInput
            autoComplete="one-time-code"
            name="device-code"
            autoFocus
            inputMode="text"
            maxLength={12}
            onChange={(event) => setUserCode(event.target.value)}
            placeholder="ABCD-1234"
            value={userCode}
          />
        </Field>
        <Button disabled={!normalizedCode} type="submit">
          Continue
        </Button>
      </form>
    )
  }

  return (
    <div className="grid gap-5">
      {verifiedCode || normalizedCode ? (
        <dl className="decisionFacts">
          <div>
            <dt>Code</dt>
            <dd>{verifiedCode || normalizedCode}</dd>
          </div>
        </dl>
      ) : (
        <Status tone="warning">
          Enter the device code shown by the requesting application before approving access.
        </Status>
      )}

      {error ? <Status tone="error">{error}</Status> : null}
      {message ? <Status tone="success">{message}</Status> : null}

      <div className="decisionActions">
        <Button
          disabled={!verifiedCode || submitting || !!message}
          onClick={() => void decide('deny')}
          type="button"
          variant="outline"
        >
          <XCircle aria-hidden="true" />
          Deny
        </Button>
        <Button
          disabled={!verifiedCode || submitting || !!message}
          onClick={() => void decide('approve')}
          type="button"
        >
          <CheckCircle2 aria-hidden="true" />
          {submitting ? 'Approving…' : 'Approve'}
        </Button>
      </div>
    </div>
  )
}

function normalizeUserCode(value: string) {
  return value.trim().replaceAll('-', '').replace(/\s+/g, '').toUpperCase()
}

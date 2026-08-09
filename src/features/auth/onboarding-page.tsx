import { KeyRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { LinkButton } from '@/components/link-button'
import { Field, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import { createOnboardingAdmin, getOnboardingStatus } from '@/lib/api'
import { tt } from '@/lib/i18n'
import { deduplicateRequest } from '@/lib/request-deduplication'

export function OnboardingRoute() {
  const { data: config } = useConfigz()
  const [status, setStatus] = useState<{
    required: boolean
  } | null>(null)
  const [submit, setSubmit] = useState({
    loading: false,
    message: null as string | null,
    error: null as string | null,
  })
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    let active = true
    deduplicateRequest('onboarding-status', getOnboardingStatus).then((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmit({
      loading: true,
      message: null,
      error: null,
    })
    try {
      await createOnboardingAdmin({
        email,
        name,
        password,
        username: username || undefined,
      })
      setStatus({
        required: false,
      })
      setSubmit({
        loading: false,
        message: tt('First admin created. Sign in to finish Console setup.'),
        error: null,
      })
    } catch (error) {
      setSubmit({
        loading: false,
        message: null,
        error: error instanceof Error ? tt(error.message) : tt('Onboarding failed.'),
      })
    }
  }

  return (
    <AuthLayout
      config={config}
      description={tt('Start this deployment from the browser, then continue to Console setup.')}
      eyebrow="First-run onboarding"
      title={tt('Create the first admin.')}
    >
      {status?.required === false || submit.message ? (
        <>
          <Status tone="success">{submit.message ?? tt('First-admin onboarding is already locked.')}</Status>
          <LinkButton to="/auth/sign-in?return_to=/console/onboarding">
            <KeyRound size={18} /> {tt('Continue to sign in')}{' '}
          </LinkButton>
        </>
      ) : (
        <form className="formStack" onSubmit={onSubmit}>
          <Field label={tt('Name')}>
            <TextInput
              autoComplete="name"
              name="name"
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </Field>
          <Field label={tt('Email')}>
            <TextInput
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </Field>
          <Field label={tt('Username')}>
            <TextInput
              autoComplete="username"
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              value={username}
            />
          </Field>
          <Field label={tt('Password')}>
            <TextInput
              autoComplete="new-password"
              name="password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          <Button disabled={submit.loading} type="submit">
            {' '}
            {tt('Create first admin')}{' '}
          </Button>
        </form>
      )}
      {submit.error ? <Status tone="error">{submit.error}</Status> : null}
    </AuthLayout>
  )
}

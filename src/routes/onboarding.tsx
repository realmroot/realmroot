import { KeyRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, TextInput } from '@/components/ui/field'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import { createOnboardingAdmin, getOnboardingStatus } from '@/lib/api'

export function OnboardingRoute() {
  const { data: config } = useConfigz()
  const [status, setStatus] = useState<{ required: boolean } | null>(null)
  const [submit, setSubmit] = useState({ loading: false, message: null as string | null, error: null as string | null })
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    let active = true
    getOnboardingStatus().then((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmit({ loading: true, message: null, error: null })
    try {
      await createOnboardingAdmin({
        email,
        name,
        password,
        username: username || undefined,
      })
      setStatus({ required: false })
      setSubmit({ loading: false, message: 'First admin created. Sign in to finish admin onboarding.', error: null })
    } catch (error) {
      setSubmit({
        loading: false,
        message: null,
        error: error instanceof Error ? error.message : 'Onboarding failed.',
      })
    }
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="First-run onboarding"
      title="Create the first admin."
      description="Start this deployment from the browser, then continue to the admin console."
    >
      {status?.required === false || submit.message ? (
        <>
          <Status tone="success">{submit.message ?? 'First-admin onboarding is already locked.'}</Status>
          <LinkButton href="/sign-in?return_to=/admin/onboarding">
            <KeyRound size={18} />
            Continue to sign in
          </LinkButton>
        </>
      ) : (
        <form className="formStack" onSubmit={onSubmit}>
          <Field label="Name">
            <TextInput autoComplete="name" onChange={(event) => setName(event.target.value)} required value={name} />
          </Field>
          <Field label="Email">
            <TextInput
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </Field>
          <Field label="Username">
            <TextInput autoComplete="username" onChange={(event) => setUsername(event.target.value)} value={username} />
          </Field>
          <Field label="Password">
            <TextInput
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          <Button disabled={submit.loading} type="submit">
            Create first admin
          </Button>
        </form>
      )}
      {submit.error ? <Status tone="error">{submit.error}</Status> : null}
    </AuthLayout>
  )
}

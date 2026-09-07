import type { ErrorComponentProps } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { ApiRequestError } from '@/lib/api'
import { tt } from '@/lib/i18n'

// Recovery must remain usable when configuration loading or the router itself fails.
function ErrorPage({
  title,
  description,
  message,
  code,
}: {
  title: string
  description: string
  message: string
  code?: string
}) {
  return (
    <AuthLayout
      config={null}
      icon={<CircleAlert aria-hidden="true" size={28} />}
      layout="focused"
      variant="message"
      title={tt(title)}
      description={tt(description)}
    >
      <Status tone="error">{tt(message)}</Status>
      {code ? (
        <p>
          {tt('Error code')}: <code>{code}</code>
        </p>
      ) : null}
      <div className="grid gap-2">
        <Button asChild className="text-primary-foreground!">
          <a href="/auth/sign-in">{tt('auth.backToSignIn')}</a>
        </Button>
        <Button asChild variant="outline">
          <a href="/">{tt('Account Center')}</a>
        </Button>
      </div>
    </AuthLayout>
  )
}

export function AuthErrorPage() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('error')
  const description = params.get('error_description')
  const knownMessage =
    code && Object.hasOwn(authorizationErrorMessages, code) ? authorizationErrorMessages[code] : undefined
  return (
    <ErrorPage
      title="Sign-in could not continue."
      description="Return to the application to start again. If access is denied, ask its administrator to check your permissions."
      message={description?.trim() || knownMessage || 'Unable to complete this request. Please try again.'}
      code={code || undefined}
    />
  )
}

export function RouteErrorPage({ error }: ErrorComponentProps) {
  return (
    <ErrorPage
      title="Unable to open this page."
      description="Reload the page or use one of the links below."
      message={
        error instanceof ApiRequestError
          ? error.message
          : 'Unable to load this page. Please reload it or try again later.'
      }
      code={error instanceof ApiRequestError ? String(error.status) : undefined}
    />
  )
}

export function PageNotFound() {
  return (
    <ErrorPage
      title="Page not found."
      description="The page may have moved or the address may be incorrect."
      message="Check the address or return to Account Center."
      code="404"
    />
  )
}

export function RoutePendingPage() {
  return (
    <AuthLayout
      config={null}
      layout="focused"
      title={tt('Loading this page…')}
      description={tt('If this takes too long, reload the page or return to the requesting application.')}
    >
      <Status>{tt('Checking your access…')}</Status>
      <a href="/auth/sign-in">{tt('auth.backToSignIn')}</a>
    </AuthLayout>
  )
}

export function ConfigurationLoadPage({ error }: { error: string | null }) {
  return error ? (
    <ErrorPage
      title="Unable to load sign-in settings."
      description="Reload the page or use one of the links below."
      message={error}
    />
  ) : (
    <RoutePendingPage />
  )
}

const authorizationErrorMessages: Record<string, string> = {
  access_denied:
    'Access was denied. Use an account with the required permissions or contact the application administrator.',
  invalid_target:
    'The requested resource is unavailable to this account. Ask the application administrator to check resource visibility.',
  invalid_client: 'The application could not be verified. Return to the application and contact its administrator.',
  invalid_request: 'This authorization request is invalid or incomplete. Start again from the application.',
  invalid_redirect: 'The application callback address is invalid. Contact the application administrator.',
  invalid_scope: 'The application requested permissions that are not available. Contact its administrator.',
  server_error: 'The service is temporarily unavailable. Please try again later.',
  temporarily_unavailable: 'The service is temporarily unavailable. Please try again later.',
}

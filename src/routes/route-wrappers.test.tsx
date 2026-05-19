import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountRoute } from './account'
import { AuthCallbackRoute } from './auth-callback'
import { EmailVerificationRoute } from './email-verification'
import { ForgotPasswordRoute } from './forgot-password'
import { OAuthConsentRoute } from './oauth/consent'
import { SignUpRoute } from './sign-up'

vi.mock('@/features/account/account-center', () => ({
  AccountCenter: () => <div>Account center route</div>,
  AccountCenterPage: () => <div>Account center route</div>,
}))

vi.mock('@/features/auth/auth-pages', () => ({
  AuthCallbackPage: () => <div>Auth callback route</div>,
  EmailVerificationPage: () => <div>Email verification route</div>,
  ForgotPasswordPage: () => <div>Forgot password route</div>,
  SignUpPage: () => <div>Sign up route</div>,
}))

vi.mock('@/features/auth/consent-page', () => ({
  ConsentPage: () => <div>Consent route</div>,
}))

afterEach(() => {
  cleanup()
})

describe('route wrappers', () => {
  it('renders hosted auth and account route components', () => {
    render(
      <>
        <SignUpRoute />
        <ForgotPasswordRoute />
        <EmailVerificationRoute />
        <AuthCallbackRoute />
        <AccountRoute />
        <OAuthConsentRoute />
      </>,
    )

    expect(screen.getByText('Sign up route')).toBeTruthy()
    expect(screen.getByText('Forgot password route')).toBeTruthy()
    expect(screen.getByText('Email verification route')).toBeTruthy()
    expect(screen.getByText('Auth callback route')).toBeTruthy()
    expect(screen.getByText('Account center route')).toBeTruthy()
    expect(screen.getByText('Consent route')).toBeTruthy()
  })
})

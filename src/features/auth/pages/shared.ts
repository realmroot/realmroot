import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  Mail,
  Smartphone,
  Wallet,
} from 'lucide-react'
import { type ComponentProps, type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createSiweMessage } from 'viem/siwe'
import { AuthLayout } from '@/components/layout/auth-layout'
import { LinkButton } from '@/components/link-button'
import { Field, TextInput } from '@/components/product-form'
import { ProviderIcon } from '@/components/provider-icon'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { ApiRequestError } from '@/lib/api'
import {
  requestEmailOtp,
  requestEmailOtpPasswordReset,
  requestPhoneOtp,
  requestWalletNonce,
  resetPasswordWithEmailOtp,
  signInWithEmailOtp,
  signInWithOneTap,
  signInWithPasskey,
  signInWithPassword,
  signInWithSocial,
  signInWithUsername,
  signInWithWallet,
  signUp,
  verifyEmail,
  verifyEmailOtp,
  verifyPhoneNumber,
  verifySignInTotp,
} from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { callbackURL, safeRedirectPath, useConfigz } from '../hooks'

export type { ComponentProps, FormEvent, ReactNode }
export {
  ApiRequestError,
  ArrowLeft,
  ArrowRight,
  AuthLayout,
  Button,
  CircleAlert,
  callbackURL,
  createSiweMessage,
  Eye,
  EyeOff,
  Field,
  Fingerprint,
  KeyRound,
  LinkButton,
  LoaderCircle,
  Mail,
  ProviderIcon,
  requestEmailOtp,
  requestEmailOtpPasswordReset,
  requestPhoneOtp,
  requestWalletNonce,
  resetPasswordWithEmailOtp,
  Smartphone,
  Status,
  safeRedirectPath,
  signInWithEmailOtp,
  signInWithOneTap,
  signInWithPasskey,
  signInWithPassword,
  signInWithSocial,
  signInWithUsername,
  signInWithWallet,
  signUp,
  TextInput,
  tt,
  useConfigz,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  verifyEmail,
  verifyEmailOtp,
  verifyPhoneNumber,
  verifySignInTotp,
  Wallet,
}

export type SubmitState = {
  loading: boolean
  message: string | null
  error: string | null
}
export type SignInMode = 'password' | 'otp' | 'phone'
export type SignInStep = 'credential' | 'otp-code'
export const passwordResetResendCooldownSeconds = 60
declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback': () => void
          'error-callback': () => void
        },
      ) => string
      remove: (widget: string) => void
    }
    hcaptcha?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback': () => void
          'error-callback': () => void
        },
      ) => string | number
      remove: (widget: string | number) => void
    }
    grecaptcha?: {
      enterprise: {
        render: (
          element: HTMLElement,
          options: {
            sitekey: string
            callback: (token: string) => void
            'expired-callback': () => void
            'error-callback': () => void
          },
        ) => number
        reset: (widget: number) => void
      }
    }
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string
            callback: (response: { credential?: string }) => void
            auto_select?: boolean
            cancel_on_tap_outside?: boolean
            context?: 'signin' | 'signup' | 'use'
            ux_mode?: 'popup' | 'redirect'
            use_fedcm_for_prompt?: boolean
          }) => void
          prompt: (listener?: (notification: GooglePromptNotification) => void) => void
        }
      }
    }
    googleScriptInitialized?: boolean
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    }
  }
}
export type GooglePromptNotification = {
  getDismissedReason?: () => string
  getNotDisplayedReason?: () => string
  getSkippedReason?: () => string
  isDismissedMoment?: () => boolean
  isNotDisplayed?: () => boolean
  isSkippedMoment?: () => boolean
}
export const initialSubmitState: SubmitState = {
  loading: false,
  message: null,
  error: null,
}

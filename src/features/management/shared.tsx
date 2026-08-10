import type {
  AgentProtocolAgent,
  AgentProtocolApprovalRequest,
  AgentProtocolCapabilityGrant,
  AgentProtocolHost,
} from '@shared/api/agents'
import {
  type ApplicationOidcClaims,
  type ApplicationResponse,
  createApplicationRequestSchema,
  updateApplicationRequestSchema,
} from '@shared/api/applications'
import {
  createApiResourceRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
  updateApiResourceRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { hostedCustomCssSchema } from '@shared/api/configz'
import type { ConnectorResponse, ConnectorTemplate } from '@shared/api/connectors'
import {
  createManagementConnectorRequestSchema,
  createManagementFederatedCredentialRequestSchema,
  type ListManagementConnectorsResponse,
  type ManagementFederatedCredentialResponse,
  type ManagementReadinessItem,
  type ManagementSignInSettingsResponse,
  type ManagementUserResponse,
  managementCreateUserRequestSchema,
  managementUpdateUserRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
  updateManagementFederatedCredentialRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import type { SecurityPolicyResponse as SecurityPolicy } from '@shared/api/security'
import {
  createWebhookEndpointRequestSchema,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookRequest,
  webhookEvents,
} from '@shared/api/webhooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  AppWindow,
  Bot,
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Globe2,
  ImageUp,
  KeyRound,
  LifeBuoy,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Server,
  Smartphone,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  type CSSProperties,
  createElement,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useState,
} from 'react'
import type { z } from 'zod'
import { AuthCardFrame } from '@/components/layout/auth-layout'
import { LinkButton } from '@/components/link-button'
import { Field, SelectInput, TextArea, TextInput } from '@/components/product-form'
import { ProviderIcon } from '@/components/provider-icon'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { SettingRow } from '@/components/ui/setting-row'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SignInCardBody, SignInMethodButtons } from '@/features/auth/pages/controls'
import { SignUpCardBody, SignUpForm } from '@/features/auth/pages/sign-up'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ConsoleActionBar, ConsoleDetailStack, ConsoleToolbar } from './primitives'

type FormState = Record<string, string>
const emptyForm: FormState = {}
const emptyConnectorsResponse: ListManagementConnectorsResponse = {
  connectors: [],
  pagination: {
    limit: 50,
    offset: 0,
    total: 0,
    hasMore: false,
    nextOffset: null,
  },
}
const optionalAuthorizationFieldNames = new Set(['description', 'disabledReason', 'displayName'])
type DetailTab = {
  value: string
  label: string
}
type ApplicationDetailSection = 'overview' | 'oauth' | 'permissions' | 'authorizations' | 'settings'
type UserDetailSection =
  | 'overview'
  | 'authentication'
  | 'sessions'
  | 'permissions'
  | 'agents'
  | 'authorized-apps'
  | 'settings'
type OrganizationDetailSection = 'overview' | 'members' | 'agents' | 'activity' | 'settings'
type RoleDetailSection = 'overview' | 'permissions' | 'settings'
type ApiResourceDetailSection = 'overview' | 'scopes' | 'endpoints' | 'settings'
type WebhooksSection = 'endpoints' | 'requests'
type SignInMode = 'password' | 'otp'
type HostedAuthPreviewFlow = 'sign-in' | 'email' | 'sign-up'
type HostedAuthPreviewState = {
  backgroundColor?: string
  customCss?: string
  description: string
  emailOtpEnabled?: boolean
  headline: string
  identifierFirst?: boolean
  logoUrl?: string
  passwordEnabled?: boolean
  primaryColor?: string
  privacyUri?: string
  productName: string
  passkeysEnabled?: boolean
  phoneEnabled?: boolean
  oneTapEnabled?: boolean
  signupEnabled?: boolean
  socialLoginEnabled?: boolean
  socialProviders?: Array<{
    displayName: string
    icon: string
    providerId: string
    slug: string
  }>
  supportEmail?: string
  supportUri?: string
  termsUri?: string
  usernameEnabled?: boolean
  web3WalletEnabled?: boolean
}
type SmsProviderId = ManagementSignInSettingsResponse['builtInProviders']['phone']['smsProvider']
const smsProviderOptions: Array<{
  value: SmsProviderId
  label: string
}> = [
  {
    value: 'twilio',
    label: 'Twilio',
  },
  {
    value: 'vonage',
    label: 'Vonage',
  },
  {
    value: 'messagebird',
    label: 'MessageBird',
  },
]
const applicationTypeOptions = [
  {
    value: 'public_spa',
    title: 'Single-page app',
    description: 'Browser application using redirects and PKCE without a client secret.',
    icon: AppWindow,
  },
  {
    value: 'confidential_web',
    title: 'Traditional web app',
    description: 'Server-side application with redirects and a client secret.',
    icon: Globe2,
  },
  {
    value: 'public_native',
    title: 'Native app',
    description: 'Mobile, desktop, or CLI application using redirects and PKCE.',
    icon: Smartphone,
  },
  {
    value: 'machine',
    title: 'Machine-to-machine',
    description: 'Backend service or Worker using client credentials without redirects.',
    icon: Server,
  },
] as const

export type {
  AgentProtocolAgent,
  AgentProtocolApprovalRequest,
  AgentProtocolCapabilityGrant,
  AgentProtocolHost,
  ApiResourceDetailSection,
  ApplicationDetailSection,
  ApplicationOidcClaims,
  ApplicationResponse,
  ConnectorResponse,
  ConnectorTemplate,
  CSSProperties,
  DetailTab,
  FormEvent,
  FormState,
  HostedAuthPreviewFlow,
  HostedAuthPreviewState,
  ListManagementConnectorsResponse,
  ManagementFederatedCredentialResponse,
  ManagementReadinessItem,
  ManagementSignInSettingsResponse,
  ManagementUserResponse,
  OrganizationDetailSection,
  ReactNode,
  RoleDetailSection,
  SecurityPolicy,
  SetStateAction,
  SignInMode,
  SmsProviderId,
  UserDetailSection,
  WebhookEndpoint,
  WebhookEvent,
  WebhookRequest,
  WebhooksSection,
  z,
}
export {
  AlertCircle,
  AppWindow,
  AuthCardFrame,
  applicationTypeOptions,
  Badge,
  Bot,
  Button,
  CalendarDays,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckCircle2,
  ConsoleActionBar,
  ConsoleDetailStack,
  ConsoleToolbar,
  Copy,
  cn,
  createApiResourceRequestSchema,
  createApplicationRequestSchema,
  createElement,
  createManagementConnectorRequestSchema,
  createManagementFederatedCredentialRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
  createWebhookEndpointRequestSchema,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ExternalLink,
  Eye,
  emptyConnectorsResponse,
  emptyForm,
  Field,
  Globe2,
  hostedCustomCssSchema,
  ImageUp,
  KeyRound,
  LifeBuoy,
  LinkButton,
  Mail,
  MoreHorizontal,
  managementCreateUserRequestSchema,
  managementUpdateUserRequestSchema,
  optionalAuthorizationFieldNames,
  PageHeader,
  Plus,
  ProviderIcon,
  RefreshCw,
  Save,
  SelectInput,
  Server,
  SettingRow,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SignInCardBody,
  SignInMethodButtons,
  SignUpCardBody,
  SignUpForm,
  Smartphone,
  Switch,
  smsProviderOptions,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextArea,
  TextInput,
  Trash2,
  tt,
  Undo2,
  updateApiResourceRequestSchema,
  updateApplicationRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
  updateManagementFederatedCredentialRequestSchema,
  updateManagementSignInSettingsRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
  useEffect,
  useId,
  useMutation,
  useNavigate,
  useQuery,
  useQueryClient,
  useState,
  webhookEvents,
}

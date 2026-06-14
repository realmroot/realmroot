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
  type assignRoleRequestSchema,
  createApiPermissionRequestSchema,
  createApiResourceRequestSchema,
  createApiScopeRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
  tokenClaimsSchema,
  updateApiPermissionRequestSchema,
  updateApiResourceRequestSchema,
  updateApiScopeRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { hostedCustomCssSchema } from '@shared/api/configz'
import type { ConnectorResponse, ConnectorTemplate } from '@shared/api/connectors'
import {
  createManagementConnectorRequestSchema,
  type ListManagementConnectorsResponse,
  type ManagementReadinessItem,
  type ManagementSignInSettingsResponse,
  type ManagementUserResponse,
  managementCreateUserRequestSchema,
  managementUpdateUserRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
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
import { ProviderIcon } from '@/components/provider-icon'
import { Badge } from '@/components/ui/badge'
import { Button, LinkButton } from '@/components/ui/button'
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
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field'
import { PageHeader } from '@/components/ui/page-header'
import { SettingRow } from '@/components/ui/setting-row'
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableEmptyRow, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SignInCardBody, SignInMethodButtons } from '@/features/auth/pages/controls'
import { SignUpCardBody, SignUpForm } from '@/features/auth/pages/sign-up'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ConsoleActionBar, ConsoleDetailStack, ConsoleToolbar } from './console-primitives'

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
const tokenClaimsObjectSchema = tokenClaimsSchema.optional()
const optionalAuthorizationFieldNames = new Set([
  'description',
  'disabledReason',
  'displayName',
  'tokenClaimName',
  'tokenClaimValue',
  'tokenClaimsNamespace',
])
type DetailTab = {
  value: string
  label: string
}
type ApplicationDetailSection = 'settings' | 'branding'
type UserDetailSection = 'profile' | 'security' | 'sessions' | 'linked-accounts' | 'applications' | 'operations'
type OrganizationDetailSection = 'settings' | 'authorization'
type RoleDetailSection = 'settings' | 'permissions' | 'assignments'
type ApiResourceDetailSection = 'settings' | 'scopes' | 'permissions'
type OrganizationTemplateSection = 'organization-roles' | 'organization-permissions'
type WebhooksSection = 'endpoints' | 'requests'
type SignInPreviewSurface = 'desktop' | 'mobile'
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
    description: 'Browser client using authorization code with PKCE and no client secret.',
    icon: AppWindow,
  },
  {
    value: 'confidential_web',
    title: 'Traditional web app',
    description: 'Server-rendered or backend app that can hold a confidential client secret.',
    icon: Globe2,
  },
  {
    value: 'public_native',
    title: 'Native app',
    description: 'Mobile or desktop client using app redirects and PKCE protection.',
    icon: Smartphone,
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
  assignRoleRequestSchema,
  ConnectorResponse,
  ConnectorTemplate,
  CSSProperties,
  DetailTab,
  FormEvent,
  FormState,
  HostedAuthPreviewFlow,
  HostedAuthPreviewState,
  ListManagementConnectorsResponse,
  ManagementReadinessItem,
  ManagementSignInSettingsResponse,
  ManagementUserResponse,
  OrganizationDetailSection,
  OrganizationTemplateSection,
  ReactNode,
  RoleDetailSection,
  SecurityPolicy,
  SetStateAction,
  SignInMode,
  SignInPreviewSurface,
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
  createApiPermissionRequestSchema,
  createApiResourceRequestSchema,
  createApiScopeRequestSchema,
  createApplicationRequestSchema,
  createElement,
  createManagementConnectorRequestSchema,
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
  tokenClaimsObjectSchema,
  tokenClaimsSchema,
  tt,
  Undo2,
  updateApiPermissionRequestSchema,
  updateApiResourceRequestSchema,
  updateApiScopeRequestSchema,
  updateApplicationRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
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

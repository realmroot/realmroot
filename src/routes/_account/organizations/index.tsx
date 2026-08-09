import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationsPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/organizations/')({ component: AccountOrganizationsPage })

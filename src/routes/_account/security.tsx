import { createFileRoute } from '@tanstack/react-router'
import { AccountSecurityPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/security')({ component: AccountSecurityPage })

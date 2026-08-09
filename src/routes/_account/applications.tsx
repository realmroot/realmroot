import { createFileRoute } from '@tanstack/react-router'
import { AccountApplicationsPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/applications')({ component: AccountApplicationsPage })

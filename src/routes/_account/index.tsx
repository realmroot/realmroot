import { createFileRoute } from '@tanstack/react-router'
import { AccountOverviewPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/')({ component: AccountOverviewPage })

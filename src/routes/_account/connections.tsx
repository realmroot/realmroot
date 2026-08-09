import { createFileRoute } from '@tanstack/react-router'
import { AccountConnectionsPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/connections')({ component: AccountConnectionsPage })

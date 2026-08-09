import { createFileRoute } from '@tanstack/react-router'
import { AccountAgentsPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/agents')({ component: AccountAgentsPage })

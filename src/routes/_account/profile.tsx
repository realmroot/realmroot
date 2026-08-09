import { createFileRoute } from '@tanstack/react-router'
import { AccountProfilePage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/profile')({ component: AccountProfilePage })

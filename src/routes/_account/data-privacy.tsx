import { createFileRoute } from '@tanstack/react-router'
import { AccountDataPrivacyPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/data-privacy')({ component: AccountDataPrivacyPage })

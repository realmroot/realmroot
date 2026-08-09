import { createFileRoute } from '@tanstack/react-router'
import { ContentSettingsPage } from '@/features/console/extracted/branding-content/content-settings'

export const Route = createFileRoute('/console/sign-in-experience/content')({ component: ContentSettingsPage })

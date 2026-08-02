import { UserDetailPage } from './user-detail'

export function UserProfilePage({ userId }: { userId: string }) {
  return <UserDetailPage userId={userId} section="overview" />
}

export function UserSecurityPage({ userId }: { userId: string }) {
  return <UserDetailPage userId={userId} section="authentication" />
}

export function UserSessionsPage({ userId }: { userId: string }) {
  return <UserDetailPage userId={userId} section="sessions" />
}

export function UserLinkedAccountsPage({ userId }: { userId: string }) {
  return <UserDetailPage userId={userId} section="authentication" />
}

export function UserApplicationsPage({ userId }: { userId: string }) {
  return <UserDetailPage userId={userId} section="authorized-apps" />
}

export function UserOperationsPage({ userId }: { userId: string }) {
  return <UserDetailPage userId={userId} section="settings" />
}

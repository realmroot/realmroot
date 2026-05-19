import { AccountCenter, type AccountSectionId } from '@/features/account/account-center'

export function AccountRoute({ section = 'profile' }: { section?: AccountSectionId }) {
  return <AccountCenter section={section} />
}

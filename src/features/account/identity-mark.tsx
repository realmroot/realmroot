import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export function IdentityMark({
  name,
  image,
  application = false,
}: {
  name: string
  image?: string | null
  application?: boolean
}) {
  return (
    <Avatar className={cn('accountIdentityMark', application && 'is-application')}>
      {image ? <AvatarImage alt="" src={image} /> : null}
      <AvatarFallback>{name.slice(0, 2)}</AvatarFallback>
    </Avatar>
  )
}

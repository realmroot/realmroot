import { Link, useRouter } from '@tanstack/react-router'
import type { AnchorHTMLAttributes } from 'react'

type SpaLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string
}

export function SpaLink({ to, ...props }: SpaLinkProps) {
  const router = useRouter({ warn: false })
  if (!router) return <a {...props} href={to} />
  return <Link {...props} to={to} />
}

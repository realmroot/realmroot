import type { VariantProps } from 'class-variance-authority'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { SpaLink } from '@/components/spa-link'
import { Button, type buttonVariants } from '@/components/ui/button'

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  size?: VariantProps<typeof buttonVariants>['size']
  to?: string
  variant?: VariantProps<typeof buttonVariants>['variant']
}

export function LinkButton({ children, size, to, variant, ...props }: LinkButtonProps) {
  return (
    <Button asChild size={size} variant={variant}>
      {to ? (
        <SpaLink {...props} to={to}>
          {children}
        </SpaLink>
      ) : (
        <a {...props}>{children}</a>
      )}
    </Button>
  )
}

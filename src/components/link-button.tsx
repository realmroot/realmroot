import type { VariantProps } from 'class-variance-authority'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Button, type buttonVariants } from '@/components/ui/button'

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  size?: VariantProps<typeof buttonVariants>['size']
  variant?: VariantProps<typeof buttonVariants>['variant']
}

export function LinkButton({ children, size, variant, ...props }: LinkButtonProps) {
  return (
    <Button asChild size={size} variant={variant}>
      <a {...props}>{children}</a>
    </Button>
  )
}

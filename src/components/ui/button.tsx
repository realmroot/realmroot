import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'default' | 'sm' | 'icon'
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
}

export function Button({ className, size = 'default', variant = 'primary', ...props }: ButtonProps) {
  return <button className={buttonClass(variant, size, className)} {...props} />
}

export function LinkButton({ className, size = 'default', variant = 'primary', ...props }: LinkButtonProps) {
  return <a className={buttonClass(variant, size, className)} {...props} />
}

function buttonClass(variant: ButtonProps['variant'], size: ButtonProps['size'], className?: string) {
  return ['uiButton', `uiButton-${variant}`, `uiButton-${size}`, className].filter(Boolean).join(' ')
}

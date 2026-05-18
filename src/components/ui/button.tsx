import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  variant?: ButtonProps['variant']
}

export function Button({ className, variant = 'primary', ...props }: ButtonProps) {
  return <button className={buttonClass(variant, className)} {...props} />
}

export function LinkButton({ className, variant = 'primary', ...props }: LinkButtonProps) {
  return <a className={buttonClass(variant, className)} {...props} />
}

function buttonClass(variant: ButtonProps['variant'], className?: string) {
  return ['uiButton', `uiButton-${variant}`, className].filter(Boolean).join(' ')
}

import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> & {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Switch({ checked, className, onCheckedChange, ...props }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      onClick={() => onCheckedChange?.(!checked)}
      role="switch"
      type="button"
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}

import type { ReactNode } from 'react'

type StatusProps = {
  children: ReactNode
  tone?: 'info' | 'success' | 'error' | 'warning'
}

export function Status({ children, tone = 'info' }: StatusProps) {
  const liveProps = tone === 'error' ? { role: 'alert' } : { 'aria-live': 'polite' as const, role: 'status' }

  return (
    <div className={`status status-${tone}`} {...liveProps}>
      {children}
    </div>
  )
}

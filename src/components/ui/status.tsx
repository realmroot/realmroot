import type { ReactNode } from 'react'

type StatusProps = {
  children: ReactNode
  tone?: 'info' | 'success' | 'error' | 'warning'
}

export function Status({ children, tone = 'info' }: StatusProps) {
  return <div className={`status status-${tone}`}>{children}</div>
}

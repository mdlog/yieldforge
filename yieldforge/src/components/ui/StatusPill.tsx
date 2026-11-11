import type { ReactNode } from 'react'

export function StatusPill({
  children,
  tone = 'neutral',
  dot = true,
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'lime'
  dot?: boolean
}) {
  return (
    <span className={`status-pill status-${tone}`}>
      {dot && <span className="status-dot" aria-hidden />}
      {children}
    </span>
  )
}

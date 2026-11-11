import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export function RiskCallout({
  title = 'Read before you sign',
  children,
  tone = 'default',
}: {
  title?: string
  children: ReactNode
  tone?: 'default' | 'danger' | 'lime'
}) {
  return (
    <div className={`risk-callout risk-${tone}`} role="note" aria-label={title}>
      <div className="risk-callout-icon" aria-hidden>
        <CircleAlert size={17} />
      </div>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
}

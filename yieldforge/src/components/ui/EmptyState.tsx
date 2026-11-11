import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-mark" aria-hidden>
        <Info size={21} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

/** Compact centered notice for empty, loading, or disconnected states inside a panel. */
export function InlineEmpty({ title, detail, action }: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="inline-empty" role="status">
      <p>{title}</p>
      {detail && <small>{detail}</small>}
      {action && <div className="inline-empty-actions">{action}</div>}
    </div>
  )
}

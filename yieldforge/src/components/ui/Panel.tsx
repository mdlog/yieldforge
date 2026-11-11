import type { ReactNode } from 'react'

export function Panel({ children, className = '', dark = false }: { children: ReactNode; className?: string; dark?: boolean }) {
  return <section className={`panel ${dark ? 'panel-dark' : ''} ${className}`}>{children}</section>
}

export function SectionHeading({
  index,
  eyebrow,
  title,
  description,
  action,
}: {
  index?: string
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="section-heading">
      <div className="section-heading-copy">
        <div className="heading-line">
          {index && <span className="section-index">{index}</span>}
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        </div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="section-heading-action">{action}</div>}
    </div>
  )
}

export function Eyebrow({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'lime' | 'rust' | 'blue' }) {
  return <span className={`eyebrow eyebrow-${tone}`}>{children}</span>
}

export function DividerLabel({ children }: { children: ReactNode }) {
  return (
    <div className="divider-label">
      <span>{children}</span>
    </div>
  )
}

export function InfoLine({ label, value, hint, mono = false }: { label: string; value: ReactNode; hint?: string; mono?: boolean }) {
  return (
    <div className="info-line">
      <span>
        {label}
        {hint && <span className="info-hint">{hint}</span>}
      </span>
      <strong className={mono ? 'mono' : ''}>{value}</strong>
    </div>
  )
}

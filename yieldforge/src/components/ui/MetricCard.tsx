import type { ReactNode } from 'react'

export function MetricCard({
  label,
  value,
  detail,
  tone = 'default',
  icon,
  onClick,
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'lime' | 'dark' | 'rust'
  icon?: ReactNode
  onClick?: () => void
}) {
  const clickable = Boolean(onClick)
  return (
    <div
      className={`metric-card metric-${tone} ${clickable ? 'metric-clickable' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick?.()
        }
      }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${label}: ${value}` : undefined}
    >
      <div className="metric-top">
        <span>{label}</span>
        {icon && <span className="metric-icon" aria-hidden>{icon}</span>}
      </div>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

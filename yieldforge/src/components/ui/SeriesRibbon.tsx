import { StatusPill } from './StatusPill'

export function SeriesRibbon({ name, detail, status }: { name: string; detail: string; status: string }) {
  return (
    <div className="series-ribbon" aria-label={`Series ${name}`}>
      <span className="series-ribbon-mark" aria-hidden>
        YF
      </span>
      <div>
        <strong>{name}</strong>
        <span>{detail}</span>
      </div>
      <StatusPill tone={status === 'Deposit open' ? 'success' : 'neutral'}>{status}</StatusPill>
    </div>
  )
}

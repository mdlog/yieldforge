import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ActivityItem } from '@/lib/near/activity'
import { explorerAccountUrl, explorerTxUrl } from '@/lib/near/config'
import { formatDate, shorten } from '@/utils/format'
import { withSeries } from '@/contexts/SeriesContext'

/** Live account activity. Rows derived from contract state are labelled as such, never as transactions. */
export function ActivityList({ items, accountId }: { items: ActivityItem[]; accountId: string }) {
  return (
    <ul className="activity-list">
      {items.map((item) => {
        const title = item.hash ? shorten(item.hash, 10, 6) : item.source === 'listing' ? `Listing #${item.listingId}` : 'Series position'
        const meta = [item.failed ? 'FAILED' : null, item.method, item.receiver, item.hash ? formatDate(item.timestampMs) : 'from contract state'].filter(Boolean).join(' · ')
        const body = (
          <>
            <span className="activity-main">
              <strong>{title}</strong>
              <small>{meta}</small>
            </span>
            <span className="activity-cta">
              {item.hash ? 'Explorer' : item.source === 'listing' ? 'View listing' : 'View account'} <ArrowUpRight size={12} aria-hidden />
            </span>
          </>
        )
        return (
          <li key={item.key}>
            {item.source === 'listing' && item.listingId ? (
              <Link className="activity-item" to={withSeries(`/listing/${item.listingId}`, item.receiver)}>
                {body}
              </Link>
            ) : (
              <a className="activity-item" href={item.hash ? explorerTxUrl(item.hash) : explorerAccountUrl(accountId)} target="_blank" rel="noreferrer">
                {body}
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}

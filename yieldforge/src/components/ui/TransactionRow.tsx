import { ChevronRight } from 'lucide-react'
import { StatusPill } from './StatusPill'
import type { Transaction } from '@/types'

export function TransactionRow({ transaction, onOpen }: { transaction: Transaction; onOpen: (id: string) => void }) {
  const tone = transaction.status === 'Confirmed' ? 'success' : transaction.status === 'Failed' ? 'danger' : 'warning'
  return (
    <button className="transaction-row" onClick={() => onOpen(transaction.id)} aria-label={`${transaction.type} ${transaction.id}`}>
      <span className={`transaction-icon transaction-${transaction.type.toLowerCase()}`} aria-hidden>
        {transaction.type.slice(0, 1)}
      </span>
      <span className="transaction-main">
        <strong>{transaction.type}</strong>
        <small>
          {transaction.method} · {transaction.time}
        </small>
      </span>
      <span className="transaction-amount">{transaction.amount}</span>
      <StatusPill tone={tone}>{transaction.status}</StatusPill>
      <ChevronRight size={15} className="row-chevron" aria-hidden />
    </button>
  )
}

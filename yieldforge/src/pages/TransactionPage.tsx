import { useParams, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ShieldCheck, X } from 'lucide-react'
import { ActivityList, Button, CopyButton, DemoBanner, EmptyState, Eyebrow, InfoLine, InlineEmpty, Panel, RiskCallout, SectionHeading, StatusPill, ExplorerLink, TransactionRow } from '@/components/ui'
import { transactions, demoSeries } from '@/lib/demoData'
import { isLiveMode } from '@/lib/near/wallet'
import { explorerAccountUrl, explorerTxUrl, getNearConfig } from '@/lib/near/config'
import { useNearQuery } from '@/hooks/useNearQuery'
import { useAccountActivity } from '@/hooks/useLiveData'
import { useWallet } from '@/contexts/WalletContext'
import { formatDateTimeUtc, formatYocto, shorten } from '@/utils/format'

type IndexedTxn = Record<string, unknown>

/** NearBlocks API v3 lookup for one transaction; `data` is null when it isn't indexed (yet). */
async function fetchIndexedTxn(hash: string): Promise<IndexedTxn | null> {
  const { nearBlocksApiUrl } = getNearConfig()
  try {
    const res = await fetch(`${nearBlocksApiUrl}/v3/txns/${hash}`)
    if (!res.ok) return null
    const json = (await res.json()) as { data?: IndexedTxn | null }
    return json.data ?? null
  } catch {
    return null
  }
}

function PageHeader({ title, description }: { title: string; description: string }) {
  const navigate = useNavigate()
  return (
    <div className="page-header">
      <div>
        <Eyebrow>05 / Activity</Eyebrow>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <button className="back-button" onClick={() => navigate('/marketplace')}>
        ← Back
      </button>
    </div>
  )
}

export default function TransactionPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const live = isLiveMode()
  const cfg = getNearConfig()
  const { accountId, isConnected } = useWallet()
  const isRealHash = id.length > 20 && !id.startsWith('tx-')
  const indexed = useNearQuery(() => (live && isRealHash ? fetchIndexedTxn(id) : Promise.resolve(null)), [id])
  const activity = useAccountActivity(live && !isRealHash && isConnected ? accountId : null, 10)

  // ---- Live: one on-chain transaction --------------------------------------------------------
  if (live && isRealHash) {
    const txn = indexed.data
    const outcome = (txn?.outcomes as { status?: unknown } | undefined)?.status
    const status = indexed.loading ? 'Loading' : !txn ? 'Not indexed yet' : outcome === true ? 'Succeeded' : outcome === false ? 'Failed' : 'Indexed'
    const tone = status === 'Succeeded' ? 'success' : status === 'Failed' ? 'danger' : 'warning'
    const actions = Array.isArray(txn?.actions) ? (txn.actions as Array<Record<string, unknown>>) : []
    const method = typeof actions[0]?.method === 'string' ? (actions[0].method as string) : '—'
    const timestamp = Number(txn?.block_timestamp ?? NaN)
    const deposit = (txn?.actions_agg as { deposit?: string } | undefined)?.deposit ?? null
    return (
      <>
        <PageHeader title={`Transaction ${shorten(id, 8, 6)}`} description={`On-chain receipt via NearBlocks · NEAR ${cfg.network}`} />
        <DemoBanner />
        <Panel>
          <div className="receipt-top">
            <div className={`receipt-icon receipt-${tone}`} aria-hidden>
              <span>{status === 'Succeeded' ? '✓' : status === 'Failed' ? '!' : '·'}</span>
            </div>
            <div>
              <Eyebrow tone={tone === 'success' ? 'lime' : tone === 'danger' ? 'rust' : 'blue'}>On-chain transaction</Eyebrow>
              <h2>{status}</h2>
              <p>{txn ? `${String(txn.signer_account_id ?? '—')} → ${String(txn.receiver_account_id ?? '—')}` : 'The indexer can lag behind the chain. The explorer link is authoritative.'}</p>
            </div>
            <StatusPill tone={tone}>{status}</StatusPill>
          </div>
          <div className="receipt-lines">
            <InfoLine label="Transaction hash" value={id} mono />
            <InfoLine label="Contract method" value={method} mono />
            <InfoLine label="Block time" value={Number.isFinite(timestamp) ? formatDateTimeUtc(timestamp / 1e6) : '—'} />
            <InfoLine label="Attached deposit" value={deposit != null ? `${formatYocto(deposit, 6)} NEAR` : '—'} />
            <InfoLine label="Network" value={`NEAR ${cfg.network}`} />
          </div>
          <div className="receipt-actions">
            <ExplorerLink href={explorerTxUrl(id)}>Open this transaction on NEAR explorer</ExplorerLink>
            <CopyButton value={id} label="Copy hash" />
          </div>
        </Panel>
      </>
    )
  }

  // ---- Live: account activity ----------------------------------------------------------------
  if (live) {
    return (
      <>
        <PageHeader title="Recent activity" description={`On-chain activity for ${accountId ?? 'your wallet'} · NEAR ${cfg.network}`} />
        <DemoBanner />
        <Panel>
          <SectionHeading eyebrow="History" title="Your transactions" description="NearBlocks first; if the indexer has nothing yet, rows are derived from contract state and labelled as such." />
          {!isConnected || !accountId ? (
            <InlineEmpty title="Connect wallet to see activity." />
          ) : activity.loading ? (
            <InlineEmpty title="Loading recent transactions…" />
          ) : activity.data && activity.data.length > 0 ? (
            <ActivityList items={activity.data} accountId={accountId} />
          ) : (
            <InlineEmpty title="No activity yet for this wallet." />
          )}
        </Panel>
        <Panel>
          <InfoLine label="Series contract" value={cfg.seriesContractId} mono />
          <InfoLine label="Marketplace" value={cfg.marketplaceContractId} mono />
          <InfoLine label="Wallet" value={accountId ?? 'not connected'} mono />
          <ExplorerLink href={explorerAccountUrl(accountId ?? cfg.seriesContractId)}>{accountId ? 'Your address on NEAR explorer' : 'Series on NEAR explorer'}</ExplorerLink>
        </Panel>
      </>
    )
  }

  // ---- Demo ----------------------------------------------------------------------------------
  if (id === 'activity') {
    return (
      <>
        <PageHeader title="Activity" description="Demo history for product exploration. Live mode replaces this with on-chain receipts." />
        <DemoBanner />
        <Panel>
          <SectionHeading eyebrow="History" title="Recent transactions" description="Every row is simulated in demo mode and links to a receipt view." />
          {transactions.map((entry) => (
            <TransactionRow key={entry.id} transaction={entry} onOpen={(entryId) => navigate(`/transactions/${entryId}`)} />
          ))}
        </Panel>
      </>
    )
  }

  const transaction = transactions.find((t) => t.id === id)
  if (!transaction) {
    return (
      <>
        <PageHeader title="Transaction not found" description="This demo hash is not present in the local activity snapshot." />
        <DemoBanner />
        <Panel>
          <EmptyState title="No matching transaction" description="Return to activity to inspect a recorded demo receipt." action={<Button onClick={() => navigate('/transactions/activity')}>Back to activity <ArrowRight size={14} aria-hidden /></Button>} />
        </Panel>
      </>
    )
  }

  const tone = transaction.status === 'Confirmed' ? 'success' : transaction.status === 'Failed' ? 'danger' : 'warning'

  return (
    <>
      <PageHeader title="Transaction detail" description="A readable receipt for every protocol state transition." />
      <DemoBanner />

      <div className="transaction-detail-layout">
        <Panel className="receipt-panel">
          <div className="receipt-top">
            <div className={`receipt-icon receipt-${tone}`} aria-hidden>
              <span>{transaction.type.slice(0, 1)}</span>
            </div>
            <div>
              <Eyebrow tone={tone === 'success' ? 'lime' : tone === 'danger' ? 'rust' : 'blue'}>{transaction.type} transaction</Eyebrow>
              <h2>{transaction.status}</h2>
              <p>{transaction.time} · Demo indexer snapshot</p>
            </div>
            <StatusPill tone={tone}>{transaction.status}</StatusPill>
          </div>
          <div className="receipt-divider" aria-hidden />
          <div className="receipt-amount">
            <span>Asset movement</span>
            <strong>{transaction.amount}</strong>
            <small>{transaction.note}</small>
          </div>
          <div className="receipt-lines">
            <InfoLine label="Contract method" value={transaction.method} mono />
            <InfoLine label="Transaction hash" value={transaction.hash} mono />
            <InfoLine label="Network" value={`NEAR ${cfg.network}`} />
            <InfoLine label="Indexed at" value={transaction.time} />
          </div>
          {transaction.status === 'Failed' && (
            <RiskCallout tone="danger" title="Why this failed">
              {transaction.note}. No balance was consumed.
            </RiskCallout>
          )}
          <div className="receipt-actions">
            <ExplorerLink href={transaction.explorer}>Open this transaction on NEAR explorer</ExplorerLink>
            <CopyButton value={JSON.stringify(transaction, null, 2)} label="Copy receipt data" />
          </div>
        </Panel>

        <aside className="transaction-side">
          <Panel className="state-panel">
            <Eyebrow>Lifecycle state</Eyebrow>
            <div className="state-flow">
              <div className="state-node state-done">
                <span aria-hidden>
                  <Check size={13} />
                </span>
                <strong>Requested</strong>
                <small>Wallet action</small>
              </div>
              <div className="state-line state-line-done" aria-hidden />
              <div className={`state-node ${transaction.status === 'Failed' ? 'state-failed' : 'state-done'}`}>
                <span aria-hidden>{transaction.status === 'Failed' ? <X size={13} /> : <Check size={13} />}</span>
                <strong>{transaction.status === 'Failed' ? 'Rejected' : 'Settled'}</strong>
                <small>Contract callback</small>
              </div>
              <div className="state-line" aria-hidden />
              <div className="state-node">
                <span aria-hidden>3</span>
                <strong>Indexed</strong>
                <small>Portfolio update</small>
              </div>
            </div>
          </Panel>

          <Panel className="evidence-panel">
            <div className="evidence-head">
              <ShieldCheck size={16} aria-hidden />
              <span>Evidence notes</span>
            </div>
            <p>Contract state is authoritative. Indexer lag is shown separately from transaction failure.</p>
            <div className="evidence-row">
              <span>Source</span>
              <strong>YieldForge demo indexer</strong>
            </div>
            <div className="evidence-row">
              <span>Contract</span>
              <strong>{shorten(demoSeries.contract, 12, 6)}</strong>
            </div>
            <div className="evidence-row">
              <span>Explorer</span>
              <strong>NEAR Blocks</strong>
            </div>
          </Panel>

          <Panel className="next-panel panel-dark">
            <Eyebrow tone="lime">Next step</Eyebrow>
            <h3>{transaction.type === 'Deposit' ? 'See the issued claims.' : transaction.type === 'Purchase' ? 'Track your YT position.' : 'Return to the lifecycle.'}</h3>
            <button className="dark-link" onClick={() => navigate(transaction.type === 'Deposit' || transaction.type === 'Purchase' ? '/portfolio' : '/')}>
              {transaction.type === 'Deposit' || transaction.type === 'Purchase' ? 'Open portfolio' : 'Back to marketplace'} <ArrowRight size={13} aria-hidden />
            </button>
          </Panel>
        </aside>
      </div>
    </>
  )
}

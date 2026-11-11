import { useNavigate } from 'react-router-dom'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { Button, DemoBanner, DividerLabel, Eyebrow, InfoLine, Panel, RateChart, RiskCallout, SectionHeading, StatusPill, ExplorerLink, TokenBadge } from '@/components/ui'
import { demoSeries, rateHistory } from '@/lib/demoData'
import { isLiveMode } from '@/lib/near/wallet'
import { explorerAccountUrl } from '@/lib/near/config'
import { useSeriesDisplay } from '@/hooks/useSeriesDisplay'
import { useLiveListings } from '@/hooks/useLiveData'
import { isBuyable } from '@/lib/contracts/marketplace'
import { formatNear, formatYoctoInput, shorten } from '@/utils/format'
import { formatBps } from '@/utils/math'

const riskItems = [
  ['Exchange-rate decline', 'If stNEAR appreciates less than the baseline—or falls—the YT payout can be zero and PT value can be reduced under the series rules.', 'danger'],
  ['Liquidity', 'Open listings are not guaranteed buyers. Meta Pool unstake liquidity and spot liquidity are separate markets.', 'warning'],
  ['Smart contract', 'Vault, token, oracle, and callback failures may delay or reduce redemption. These contracts are not audited.', 'warning'],
  ['Market', 'A fixed price reflects one seller’s ask, not a fair value or future return.', 'default'],
] as const

export default function SeriesPage() {
  const navigate = useNavigate()
  const live = isLiveMode()
  const { display: s, loading } = useSeriesDisplay()
  const listingsQuery = useLiveListings()
  const openLive = (listingsQuery.data ?? []).filter(isBuyable).length
  const pending = loading ? '…' : '—'
  const termDays = s?.maturityMs != null && s.cutoffMs != null ? Math.round((s.maturityMs - s.cutoffMs) / 86_400_000) : null
  const rateLabel = (value: number | null | undefined, missing: string) => (value != null ? value.toFixed(4) : loading ? '…' : missing)

  return (
    <>
      <div className="page-header">
        <div>
          <Eyebrow tone="lime">01 / Series</Eyebrow>
          <h1>Series &amp; Risk Passport</h1>
          <p>Read the mechanics, then decide whether the trade-off fits your position.</p>
        </div>
        <div className="header-actions">
          <Button variant="secondary" onClick={() => navigate('/calculator')}>
            Open calculator
          </Button>
          <Button onClick={() => navigate('/earn')}>
            Deposit stNEAR <ArrowRight size={15} aria-hidden />
          </Button>
        </div>
      </div>

      <DemoBanner />

      <div className="series-layout">
        <div className="series-main">
          <Panel className="series-overview-panel">
            <div className="series-overview-head">
              <div>
                <Eyebrow tone="lime">Active series</Eyebrow>
                <h2>{s?.name ?? 'Active series'}</h2>
                <p>{s?.underlying ?? pending} · fixed maturity · fixed-price YT market</p>
              </div>
              <StatusPill tone={s?.phase === 'Deposit open' ? 'success' : 'neutral'}>{s?.phase ?? pending}</StatusPill>
            </div>
            <div className="series-big-stats">
              <div>
                <span>Baseline rate</span>
                <strong>{rateLabel(s?.baselineRate, 'not set')}</strong>
                <small>{s?.baselineCapturedLabel ? `captured ${s.baselineCapturedLabel}` : s?.baselineRate != null ? 'captured at deposit' : `read at the cutoff · ${s?.cutoffLabel ?? '—'}`}</small>
              </div>
              <div>
                <span>Current rate</span>
                <strong>{rateLabel(s?.currentRate, 'unavailable')}</strong>
                <small>{s?.rateUpdated ?? pending}</small>
              </div>
              <div>
                <span>Maturity</span>
                <strong>{s?.maturityLabel ?? pending}</strong>
                <small>{s?.daysLeft != null ? `${s.daysLeft} days remaining` : pending}</small>
              </div>
            </div>
            <div className="overview-chart">
              <div className="chart-title">
                <span>Historical exchange rate</span>
                <span className="chart-legend">
                  <i aria-hidden /> stNEAR / NEAR
                </span>
              </div>
              <RateChart points={live ? undefined : rateHistory} />
              <div className="chart-foot">
                <span>Historical data · not a forecast</span>
                <span>{live ? 'No history feed connected' : 'Source: demo snapshot'}</span>
              </div>
            </div>
          </Panel>

          <Panel className="risk-passport-panel">
            <SectionHeading index="02" eyebrow="Risk Passport" title="What you are actually buying" description="Plain-language disclosures shown before any signing step." />
            <div className="risk-list">
              {riskItems.map(([title, copy, tone], index) => (
                <div className={`risk-item risk-item-${tone}`} key={title}>
                  <span className="risk-number">0{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </div>
                  <span className="risk-symbol" aria-hidden>
                    {tone === 'danger' ? '!' : '↗'}
                  </span>
                </div>
              ))}
            </div>
            <RiskCallout tone="danger" title="No principal guarantee">
              PT is a claim under the redemption formula, not a guarantee of the original NEAR value. Slashing, contract failure, stale rate, or a falling exchange rate can reduce what is available.
            </RiskCallout>
          </Panel>
        </div>

        <aside className="series-side">
          <Panel className="terms-panel">
            <SectionHeading eyebrow="Series terms" title="Canonical inputs" />
            <InfoLine label="Underlying" value={live ? shorten(s?.underlying ?? '—', 11, 7) : 'stNEAR'} mono={live} />
            <InfoLine label="Series ID" value={s?.id ?? pending} mono />
            <InfoLine label="Contract" value={shorten(s?.contract ?? '—', 11, 7)} mono />
            <InfoLine label="Deposit cutoff" value={s?.cutoffLabel ?? pending} />
            <InfoLine label="Maturity" value={s?.maturityExactLabel ?? pending} />
            <InfoLine label="Term" value={termDays != null ? `${termDays} days after the cutoff` : pending} />
            <InfoLine label="Settlement rate" value={s?.settlementRate != null ? s.settlementRate.toFixed(4) : 'At maturity'} />
            <InfoLine label="Deposit minimum" value={s ? `${formatYoctoInput(s.minDepositYocto)} stNEAR` : pending} />
            <InfoLine label="Deposit fee" value={s ? formatBps(s.depositFeeBps) : pending} hint={s?.depositFeeSource} />
            <DividerLabel>Liquidity context</DividerLabel>
            <InfoLine label="YT listings" value={live ? (listingsQuery.loading ? '…' : `${openLive} open`) : formatNear(demoSeries.ytVolume, 0)} hint={live ? 'on-chain' : 'this market'} />
            {live && <InfoLine label="YT in escrow" value={s?.escrowedYt != null ? `${s.escrowedYt.toFixed(4)} YT` : pending} hint="held by the contract" />}
            <InfoLine label="Series TVL" value={s?.tvl != null ? (live ? `${s.tvl.toFixed(2)} stNEAR` : formatNear(s.tvl, 0)) : pending} hint={live ? 'on-chain' : 'demo'} />
            <InfoLine label="Meta Pool TVL" value="Not buyer liquidity" hint="separate" />
            <div className="terms-links">
              <ExplorerLink href={s ? explorerAccountUrl(s.contract) : undefined}>Contract explorer</ExplorerLink>
              <a href="https://docs.metapool.app" target="_blank" rel="noreferrer" className="explorer-link">
                Meta Pool docs <ExternalLink size={12} aria-hidden />
              </a>
            </div>
          </Panel>

          <Panel className="model-panel panel-dark">
            <Eyebrow tone="lime">The accounting model</Eyebrow>
            <h3>Deposit → claims → settlement.</h3>
            <div className="model-flow" aria-hidden>
              <span>stNEAR</span>
              <ArrowRight size={14} />
              <TokenBadge kind="PT" />
              <span className="model-plus">+</span>
              <TokenBadge kind="YT" />
            </div>
            <p>PT and YT are minted 1:1 against the deposit net of the protocol fee. Production formula, rounding, and loss allocation still require technical validation.</p>
            <button className="dark-link" onClick={() => navigate('/earn')}>
              Try a deposit preview <ArrowRight size={13} aria-hidden />
            </button>
          </Panel>
        </aside>
      </div>
    </>
  )
}

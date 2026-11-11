import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Gauge, Zap, ArrowDownRight, LockKeyhole } from 'lucide-react'
import { Button, DemoBanner, Eyebrow, InfoLine, Panel, RiskCallout, SectionHeading, StatusPill } from '@/components/ui'
import { useSeriesDisplay } from '@/hooks/useSeriesDisplay'
import { useLiveListings } from '@/hooks/useLiveData'
import { demoInputs, listings as demoListings } from '@/lib/demoData'
import { isLiveMode } from '@/lib/near/wallet'
import { isFillable } from '@/lib/contracts/marketplace'
import { buildScenarioRows, DEPOSIT_FEE_BPS, formatBps, MARKET_FEE_BPS } from '@/utils/math'
import { formatNear, formatYoctoInput, parseNear, toBigInt } from '@/utils/format'

function CalcField({ label, suffix, value, onChange }: { label: string; suffix: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="calc-field">
      <span>{label}</span>
      <div>
        <input inputMode="decimal" placeholder="0.0" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <em>{suffix}</em>
      </div>
    </label>
  )
}

const num = (value: string) => Math.max(0, Number(value) || 0)

export default function CalculatorPage() {
  const navigate = useNavigate()
  const live = isLiveMode()
  const { display: series } = useSeriesDisplay()
  const listingsQuery = useLiveListings()
  // Live inputs start empty or come from the chain; only the demo walkthrough is prefilled with demo values.
  const [amount, setAmount] = useState(live ? '' : demoInputs.depositAmount)
  const [baseline, setBaseline] = useState('')
  const [futureRate, setFutureRate] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [fees, setFees] = useState(formatBps(MARKET_FEE_BPS).replace('%', ''))

  // Lowest open ask in the market (exact yocto), used as the default sale price.
  const lowestAskYocto = useMemo<bigint | null>(() => {
    const asks = live
      ? (listingsQuery.data ?? []).filter(isFillable).map((l) => toBigInt(l.unitPrice))
      : demoListings.filter((l) => l.status === 'Open' || l.status === 'Partial').map((l) => parseNear(String(l.unitPrice)))
    const positive = asks.filter((a) => a > 0n)
    return positive.length ? positive.reduce((min, a) => (a < min ? a : min)) : null
  }, [live, listingsQuery.data])

  useEffect(() => {
    if (lowestAskYocto !== null) setSalePrice((v) => v || formatYoctoInput(lowestAskYocto, 4))
  }, [lowestAskYocto])

  // Prefill rates from the active series once it is known; the user can overwrite them freely.
  useEffect(() => {
    if (!series) return
    const base = series.baselineRate ?? series.currentRate
    setBaseline((v) => v || (base != null ? base.toFixed(4) : ''))
    setFutureRate((v) => v || (series.currentRate != null ? series.currentRate.toFixed(4) : ''))
  }, [series])

  const deposit = num(amount)
  const r0 = num(baseline)
  const rt = num(futureRate)
  const price = num(salePrice)
  const feeRate = num(fees) / 100
  const depositFeeBps = series?.depositFeeBps ?? DEPOSIT_FEE_BPS
  const ytUnits = deposit * (1 - Number(depositFeeBps) / 10_000)
  const proceeds = ytUnits * price
  const buyerCost = proceeds * (1 + feeRate)
  const illustrativeYield = Math.max(0, rt - r0) * ytUnits
  const buyerDelta = illustrativeYield - buyerCost
  const scenarios = r0 > 0 ? buildScenarioRows(r0, ytUnits, buyerCost) : []

  return (
    <>
      <div className="page-header">
        <div>
          <Eyebrow tone="lime">04 / Calculator</Eyebrow>
          <h1>Proceeds calculator</h1>
          <p>A clear scenario tool—not a yield predictor.</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/series')}>
          Read the model <ArrowRight size={15} aria-hidden />
        </Button>
      </div>

      <DemoBanner />

      <div className="calculator-layout">
        <Panel className="calculator-inputs">
          <div className="calculator-head">
            <div>
              <Eyebrow tone="lime">Scenario inputs</Eyebrow>
              <h2>Change the assumptions</h2>
              <p>Every output below is a function of your inputs. Nothing is labelled likely or guaranteed.</p>
            </div>
            <span className="calculator-symbol" aria-hidden>
              <Gauge size={19} />
            </span>
          </div>
          <div className="calc-field-grid">
            <CalcField label="stNEAR amount" suffix="stNEAR" value={amount} onChange={setAmount} />
            <CalcField label="Baseline rate" suffix="NEAR / stNEAR" value={baseline} onChange={setBaseline} />
            <CalcField label="Future rate scenario" suffix="NEAR / stNEAR" value={futureRate} onChange={setFutureRate} />
            <CalcField label="Proposed YT price" suffix="NEAR / YT" value={salePrice} onChange={setSalePrice} />
            <CalcField label="Fee paid by the buyer" suffix="%" value={fees} onChange={setFees} />
          </div>
          <div className="calc-context">
            <span>
              <span className="signal-dot" aria-hidden /> Series baseline
            </span>
            <strong>{series?.baselineRate != null ? `${series.baselineRate.toFixed(4)} NEAR / stNEAR` : 'not set on-chain yet'}</strong>
            <span className="context-note">prefilled above; edit freely</span>
          </div>
          <RiskCallout title="The calculator is educational">Future rate is user-entered. Historical rates are context only. If a live quote is unavailable, the product shows “quote unavailable” rather than inventing one.</RiskCallout>
        </Panel>

        <aside className="calculator-output">
          <Panel className="output-panel panel-dark">
            <Eyebrow tone="lime">Illustrative output</Eyebrow>
            <h3>{price > 0 ? `If all YT is sold at ${price.toFixed(4)} NEAR` : 'Enter a sale price'}</h3>
            <div className="output-hero">
              <span>Upfront proceeds</span>
              <strong>{formatNear(proceeds, 4)}</strong>
              <small>the {fees}% fee is paid by the buyer on top</small>
            </div>
            <div className="output-lines">
              <InfoLine label="PT at issuance" value={`${ytUnits.toFixed(2)} PT`} hint={`after ${formatBps(depositFeeBps)} deposit fee`} />
              <InfoLine label="YT at issuance" value={`${ytUnits.toFixed(2)} YT`} />
              <InfoLine label="Illustrative YT value" value={`+${formatNear(illustrativeYield, 4)}`} />
              <InfoLine label="Buyer scenario delta" value={`${buyerDelta >= 0 ? '+' : '−'}${formatNear(Math.abs(buyerDelta), 4)}`} />
            </div>
          </Panel>
          <Panel className="comparison-panel">
            <SectionHeading eyebrow="Decision context" title="What this does not compare" />
            <div className="comparison-row">
              <span className="comparison-icon" aria-hidden>
                <Zap size={15} />
              </span>
              <div>
                <strong>Fast unstake</strong>
                <p>No live quote integrated</p>
              </div>
              <span className="unavailable">Quote unavailable</span>
            </div>
            <div className="comparison-row">
              <span className="comparison-icon" aria-hidden>
                <ArrowDownRight size={15} />
              </span>
              <div>
                <strong>Spot sale</strong>
                <p>Would sell the whole stNEAR exposure</p>
              </div>
              <span className="unavailable">Not modelled</span>
            </div>
            <div className="comparison-row">
              <span className="comparison-icon" aria-hidden>
                <LockKeyhole size={15} />
              </span>
              <div>
                <strong>YieldForge</strong>
                <p>Sell a right, retain a claim</p>
              </div>
              <StatusPill tone="lime">This scenario</StatusPill>
            </div>
          </Panel>
        </aside>
      </div>

      <Panel className="scenario-reference">
        <SectionHeading
          eyebrow="Reference scenarios"
          title="One assumption at a time"
          description="Rows shift the baseline above by a fixed percentage for your YT quantity. They do not forecast the future."
          action={
            <button className="text-link" onClick={() => navigate('/series')}>
              See rate history <ArrowUpRight size={13} aria-hidden />
            </button>
          }
        />
        <div className="scenario-table">
          <div className="scenario-head" aria-hidden>
            <span>Scenario</span>
            <span>Rate at maturity</span>
            <span>Illustrative YT value</span>
            <span>Comment</span>
          </div>
          {scenarios.map((row) => (
            <div className={`scenario-row scenario-${row.tone}`} key={row.label}>
              <span>
                <i aria-hidden />
                {row.label}
              </span>
              <strong>{row.rate.toFixed(4)}</strong>
              <span>{formatNear(row.yield, 2)}</span>
              <span className="scenario-comment">{row.tone === 'risk' ? 'YT can pay zero' : row.tone === 'muted' ? 'No positive appreciation' : 'User-entered illustration'}</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

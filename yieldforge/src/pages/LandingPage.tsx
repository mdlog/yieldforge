import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Anchor,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Coins,
  Database,
  Flame,
  Globe,
  KeyRound,
  LockKeyhole,
  Pause,
  Plus,
  Scale,
  Split,
  TriangleAlert,
} from 'lucide-react'
import { TokenBadge } from '@/components/ui'
import { LandingFooter, LandingNav } from '@/components/landing/LandingChrome'
import { isLiveMode } from '@/lib/near/wallet'
import { explorerAccountUrl, getNearConfig } from '@/lib/near/config'
import { isFillable } from '@/lib/contracts/marketplace'
import { demoSeries, listings as demoListings } from '@/lib/demoData'
import { withSeries } from '@/contexts/SeriesContext'
import { bySchedule, tenorLabel, useAllSeries, type SeriesSnapshot } from '@/hooks/useAllSeries'
import type { SeriesDisplay, SeriesPhase } from '@/hooks/useSeriesDisplay'
import { formatYocto, yoctoToNumber } from '@/utils/format'
import { filledVolumeYocto, formatBps, MARKET_FEE_BPS } from '@/utils/math'
import '@/styles/landing.css'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>

const DAY_MS = 86_400_000

function fixed(n: number | null | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Small testnet balances need more decimals than mainnet-sized ones. */
function amount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  return fixed(n, abs >= 1000 ? 0 : abs >= 1 ? 2 : 4)
}

function signed(n: number, digits = 2): string {
  return `${n < 0 ? '−' : '+'}${fixed(Math.abs(n), digits)}`
}

function countdown(targetMs: number | null): string {
  if (targetMs == null) return '—'
  const diff = targetMs - Date.now()
  if (diff <= 0) return 'now'
  const days = Math.floor(diff / DAY_MS)
  const hours = Math.floor((diff % DAY_MS) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  if (days > 0) return `${days}d ${hours}h`
  return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(minutes, 1)}m`
}

const LIFECYCLE: Array<{ phase: SeriesPhase; title: string }> = [
  { phase: 'Deposit open', title: 'Deposits open' },
  { phase: 'Awaiting baseline', title: 'Baseline R0' },
  { phase: 'Active', title: 'Yield accrues' },
  { phase: 'Matured', title: 'Maturity' },
  { phase: 'Settled', title: 'Settled · RT' },
]

/** The hero's series: the open deposit window that closes first, else the nearest maturity still running. */
function pickFeatured(rows: SeriesSnapshot[]): SeriesSnapshot | null {
  const by = (key: (r: SeriesSnapshot) => number | null) => (a: SeriesSnapshot, b: SeriesSnapshot) => (key(a) ?? Infinity) - (key(b) ?? Infinity)
  const open = rows.filter((r) => r.display.depositsOpen).sort(by((r) => r.display.cutoffMs))
  if (open[0]) return open[0]
  const running = rows.filter((r) => !r.display.settled).sort(by((r) => r.display.maturityMs))
  return running[0] ?? rows[0] ?? null
}

export default function LandingPage() {
  const live = isLiveMode()
  const cfg = getNearConfig()
  const { hash } = useLocation()
  const all = useAllSeries()
  const rows = useMemo(() => [...(all.data ?? [])].sort(bySchedule), [all.data])
  const featured = useMemo(() => pickFeatured(rows), [rows])
  const series = featured?.display ?? null
  const loading = all.loading && !all.data

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash])

  const pending = live && loading ? '…' : '—'
  const rate = series?.currentRate ?? null
  const marketFee = formatBps(rows[0]?.display.marketFeeBps ?? MARKET_FEE_BPS)
  // Deposit fees are sized to each tenor (about 1% a year), so they are quoted per series.
  const depositFees = rows.length ? rows.map((r) => `${formatBps(r.display.depositFeeBps)} (${tenorLabel(r.display)})`).join(', ') : '—'

  // Collateral across every series. Before settlement each PT+YT pair redeems for exactly 1 stNEAR and an
  // unpaired claim for at most 1, so max(PT, YT) + retained fees bounds what a series can ever owe.
  const totals = useMemo(() => {
    let held = 0n
    let claims = 0n
    let fees = 0n
    let volume = 0n
    let open = 0
    let complete = rows.length > 0
    for (const r of rows) {
      const d = r.display
      if (r.heldYocto == null || d.ptSupplyYocto == null || d.ytSupplyYocto == null) complete = false
      else {
        held += r.heldYocto
        claims += d.ptSupplyYocto > d.ytSupplyYocto ? d.ptSupplyYocto : d.ytSupplyYocto
      }
      fees += d.feeBalanceYocto ?? 0n
      volume += filledVolumeYocto(r.listings)
      open += r.listings.filter(isFillable).length
    }
    const required = claims + fees
    return { held, claims, fees, volume, open, complete, ratio: complete && required > 0n ? Number((held * 10_000n) / required) / 100 : null }
  }, [rows])
  const backing = totals.complete ? totals : null

  const market = useMemo(() => {
    if (!live) {
      const open = demoListings.filter((l) => l.status === 'Open' || l.status === 'Partial').length
      return { volume: `${amount(demoSeries.ytVolume)} NEAR`, open: String(open) }
    }
    if (!all.data) return { volume: pending, open: pending }
    return { volume: `${formatYocto(totals.volume, 4)} NEAR`, open: String(totals.open) }
  }, [live, all.data, totals, pending])

  const tvl = backing ? yoctoToNumber(backing.held, 6) : null
  const tvlNear = tvl != null && rate != null ? tvl * rate : null
  const featuredHeld = featured?.heldYocto != null ? yoctoToNumber(featured.heldYocto, 6) : null
  const featuredFee = series ? formatBps(series.depositFeeBps) : '—'

  return (
    <div className="lp">
      <LandingNav page="home" />

      <header className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="lp-kicker">
              <span className="lp-pulse" aria-hidden /> Yield tokenization for NEAR staking
            </span>
            <h1>
              Tomorrow’s staking yield, <em>tradable today.</em>
            </h1>
            <p className="lp-lede">
              YieldForge splits Meta Pool stNEAR into a Principal Token and a Yield Token. Sell your yield up front for a fixed return, or buy it for
              leveraged exposure to NEAR staking rewards. The contract computes and pays every claim.
            </p>
            <div className="lp-hero-actions">
              <Link className="lp-btn lp-btn-acid" to="/marketplace">
                Launch app <ArrowRight size={16} aria-hidden />
              </Link>
              <Link className="lp-btn lp-btn-ghost" to="/earn">
                Deposit stNEAR
              </Link>
              <a className="lp-text-link" href="#how">
                How it works <ArrowRight size={13} aria-hidden />
              </a>
            </div>
            <ul className="lp-hero-trust">
              <TrustItem icon={KeyRound} title="Non-custodial" body="You sign every transaction in your own wallet." />
              <TrustItem icon={Scale} title="Fully backed" body="Each PT + YT pair redeems for exactly 1 stNEAR." />
              <TrustItem icon={Globe} title="Permissionless" body="Anyone can record the baseline and settle the series." />
            </ul>
          </div>

          <aside className="lp-live" aria-label="Live series">
            <div className="lp-live-head">
              <div>
                <span className="lp-mono-label">{live ? (series?.depositsOpen ? 'Open for deposits' : `Live · NEAR ${cfg.network}`) : 'Demo snapshot'}</span>
                <strong>{series ? `${tenorLabel(series)} series · ${series.id}` : 'stNEAR series'}</strong>
              </div>
              <span className={`lp-phase lp-phase-${series?.phase === 'Paused' ? 'paused' : 'on'}`}>{series?.phase ?? pending}</span>
            </div>

            <div className="lp-live-rate">
              <span className="lp-mono-label">stNEAR exchange rate</span>
              <strong>{rate != null ? fixed(rate, 4) : pending}</strong>
              <small>NEAR per stNEAR · read from {cfg.stNearContractId}</small>
            </div>

            <div className="lp-split" aria-label="What one deposit mints">
              <span className="lp-split-in">1 stNEAR</span>
              <ArrowRight size={14} aria-hidden />
              <span className="lp-split-out">
                <TokenBadge kind="PT" size="sm" />
                {series ? fixed(1 - Number(series.depositFeeBps) / 10_000, 4) : '—'}
              </span>
              <Plus size={12} aria-hidden />
              <span className="lp-split-out">
                <TokenBadge kind="YT" size="sm" />
                {series ? fixed(1 - Number(series.depositFeeBps) / 10_000, 4) : '—'}
              </span>
            </div>

            <dl className="lp-live-rows">
              <div>
                <dt>Value locked</dt>
                <dd>{featuredHeld != null ? `${amount(featuredHeld)} stNEAR` : pending}</dd>
              </div>
              <div>
                <dt>{series?.depositsOpen ? 'Deposits close in' : 'Maturity in'}</dt>
                <dd>{series ? countdown(series.depositsOpen ? series.cutoffMs : series.maturityMs) : pending}</dd>
              </div>
              <div>
                <dt>Maturity</dt>
                <dd>{series?.maturityExactLabel ?? pending}</dd>
              </div>
              <div>
                <dt>Fees · deposit / fill</dt>
                <dd>
                  {featuredFee} / {marketFee}
                </dd>
              </div>
            </dl>

            <div className="lp-live-foot">
              <a href={featured ? explorerAccountUrl(featured.contractId) : undefined} target="_blank" rel="noreferrer">
                <Database size={13} aria-hidden /> {live ? (featured?.contractId ?? pending) : 'Demo contract'} <ArrowUpRight size={12} aria-hidden />
              </a>
              {rows.length > 1 && (
                <a href="#series" className="lp-live-more">
                  +{rows.length - 1} more series <ArrowRight size={12} aria-hidden />
                </a>
              )}
            </div>
          </aside>
        </div>
      </header>

      <section className="lp-wrap lp-stats" aria-label="Protocol metrics">
        <Stat label="Total value locked" value={tvl != null ? amount(tvl) : pending} unit="stNEAR" detail={tvlNear != null ? `≈ ${amount(tvlNear)} NEAR · all series` : 'stNEAR held by the series contracts'} />
        <Stat label="Collateral ratio" value={backing?.ratio != null ? fixed(backing.ratio, 2) : backing ? 'n/a' : pending} unit={backing?.ratio != null ? '%' : ''} detail={backing?.ratio != null ? 'stNEAR held / maximum claims' : 'No deposits yet'} accent />
        <Stat label="YT volume filled" value={market.volume} detail="Executed fills, fees excluded" />
        <Stat label="Open listings" value={market.open} detail="Fixed-price YT offers" />
        <Stat label="Live series" value={all.data ? String(rows.length) : pending} detail={rows.length ? [...new Set(rows.map((r) => tenorLabel(r.display)))].join(' · ') : 'Tenor ladder'} />
      </section>
      <p className="lp-wrap lp-source">
        {live
          ? `Read directly from NEAR ${cfg.network} on page load and summed over every series: get_series, get_listings, get_st_near_price, ft_balance_of.`
          : 'Demo mode: these numbers are a labelled snapshot, not chain data.'}
      </p>

      <section className="lp-section" id="how" aria-labelledby="how-title">
        <div className="lp-wrap">
          <SectionHead index="01" eyebrow="How it works" title="One deposit. Two claims. Settled by the chain." id="how-title">
            Staking rewards make each stNEAR worth more NEAR over time. YieldForge separates that growth from the principal, so each side can be held or traded on its
            own.
          </SectionHead>
          <ol className="lp-steps">
            <Step n="01" icon={Coins} title="Stake">
              Turn NEAR into Meta Pool stNEAR. Rewards accrue in the stNEAR rate, not as new tokens.
            </Step>
            <Step n="02" icon={Split} title="Split">
              Deposit stNEAR before a series’ cutoff. It mints PT and YT one-for-one, minus a fee sized to the tenor: {depositFees}.
            </Step>
            <Step n="03" icon={ArrowLeftRight} title="Trade">
              List YT at a fixed price, or fill a listing. Escrowed and atomic: no AMM, no slippage, no partial surprises.
            </Step>
            <Step n="04" icon={BadgeCheck} title="Settle">
              After maturity anyone records the final rate RT. Holders burn PT or YT and receive stNEAR.
            </Step>
          </ol>
          <div className="lp-formula" aria-label="Payout formulas">
            <div>
              <TokenBadge kind="PT" />
              <code>min(R0, RT) ÷ RT</code>
              <small>stNEAR per PT · worth R0 NEAR</small>
            </div>
            <div>
              <TokenBadge kind="YT" />
              <code>max(RT − R0, 0) ÷ RT</code>
              <small>stNEAR per YT · worth RT − R0 NEAR</small>
            </div>
            <div>
              <span className="lp-tag lp-tag-eq">=</span>
              <code>PT + YT = 1 stNEAR</code>
              <small>The contract never owes more than it holds</small>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-tint" id="strategies" aria-labelledby="strategies-title">
        <div className="lp-wrap">
          <SectionHead index="02" eyebrow="Two strategies" title="Fix your yield, or amplify it." id="strategies-title">
            Every series has two sides of the same stNEAR. Pick the one that matches your view on staking rewards.
          </SectionHead>
          <div className="lp-strategies">
            <article className="lp-strategy">
              <TokenBadge kind="PT" size="lg" />
              <h3>Fix your yield</h3>
              <p>Deposit stNEAR, keep the PT, and sell the YT. You receive NEAR now and redeem your principal value at maturity.</p>
              <ul>
                <li>
                  <Check size={15} aria-hidden /> Return is known the moment your listing fills
                </li>
                <li>
                  <Check size={15} aria-hidden /> Sale proceeds are paid to you in the same transaction
                </li>
                <li>
                  <Check size={15} aria-hidden /> PT redeems R0 worth of stNEAR when the rate rises
                </li>
              </ul>
              <Link className="lp-btn lp-btn-ink" to="/earn">
                Deposit stNEAR <ArrowRight size={15} aria-hidden />
              </Link>
            </article>
            <article className="lp-strategy lp-strategy-dark">
              <TokenBadge kind="YT" size="lg" />
              <h3>Amplify the yield</h3>
              <p>Buy YT for a fraction of the principal and receive all of the rate growth from R0 to RT on the full amount.</p>
              <ul>
                <li>
                  <Check size={15} aria-hidden /> Yield exposure on principal you don’t have to own
                </li>
                <li>
                  <Check size={15} aria-hidden /> Worst case is the price you paid: no liquidations
                </li>
                <li>
                  <Check size={15} aria-hidden /> Exit early by listing your YT again
                </li>
              </ul>
              <Link className="lp-btn lp-btn-acid" to="/marketplace">
                Browse YT listings <ArrowRight size={15} aria-hidden />
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-section" id="simulate" aria-labelledby="simulate-title">
        <div className="lp-wrap">
          <SectionHead index="03" eyebrow="Simulator" title="Run the numbers before you sign." id="simulate-title">
            Uses the live terms of the series you pick. Change the deposit, your expected staking APR, and the YT price to see both sides of the trade.
          </SectionHead>
          <Simulator rows={rows} featuredId={featured?.contractId ?? null} />
        </div>
      </section>

      <section className="lp-section lp-section-tint" id="series" aria-labelledby="series-title">
        <div className="lp-wrap">
          <SectionHead index="04" eyebrow="The live series" title="A ladder of tenors, every date on-chain." id="series-title">
            Each series runs its own fixed lifecycle. Short tenors settle fast; longer ones accrue more yield per trade. New series roll in as older ones close
            their deposit window.
          </SectionHead>
          {rows.length === 0 ? (
            <p className="lp-series-empty">{loading ? 'Reading the series from the chain…' : 'No series could be read from the chain right now.'}</p>
          ) : (
            <div className="lp-series-grid">
              {rows.map((row) => (
                <SeriesCard key={row.contractId} row={row} live={live} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="lp-section" id="security" aria-labelledby="security-title">
        <div className="lp-wrap">
          <SectionHead index="05" eyebrow="Security model" title="Payouts enforced by code, not promises." id="security-title">
            The rules below are properties of the series contract. You can check each one against the chain.
          </SectionHead>
          <div className="lp-security">
            <article className="lp-sec lp-sec-feature">
              <span className="lp-sec-icon" aria-hidden>
                <Scale size={18} />
              </span>
              <h3>Fully collateralized</h3>
              <p>PT and YT payouts per unit always add up to 1 stNEAR, so the contract can never owe more stNEAR than it holds.</p>
              <div className="lp-meter" aria-label="Live collateral">
                <span className="lp-mono-label lp-meter-label">{live ? 'Live · read from chain' : 'Demo snapshot'}</span>
                <div>
                  <span>stNEAR held</span>
                  <strong>{backing ? formatYocto(backing.held, 6) : pending}</strong>
                </div>
                <div>
                  <span>PT / YT outstanding</span>
                  <strong>{backing ? formatYocto(backing.claims, 6) : pending}</strong>
                </div>
                <div>
                  <span>Retained fees</span>
                  <strong>{backing ? formatYocto(backing.fees, 6) : pending}</strong>
                </div>
                <div className="lp-meter-ratio">
                  <span>Ratio</span>
                  <strong>{backing?.ratio != null ? `${fixed(backing.ratio, 2)}%` : pending}</strong>
                </div>
              </div>
            </article>
            <SecurityCard icon={Flame} title="Burn before pay">
              Claims are burned before stNEAR leaves the contract. If the transfer fails, the claim is restored so you can retry.
            </SecurityCard>
            <SecurityCard icon={Globe} title="Permissionless lifecycle">
              Anyone can capture the baseline after the cutoff and settle after maturity. Once recorded, RT cannot change.
            </SecurityCard>
            <SecurityCard icon={Database} title="One rate source">
              Both rates come straight from Meta Pool’s get_st_near_price. No third-party oracle sits in between.
            </SecurityCard>
            <SecurityCard icon={LockKeyhole} title="Escrowed, atomic fills">
              Listed YT sits in the contract. A fill pays the seller and delivers YT in one call, refunding any excess NEAR.
            </SecurityCard>
            <SecurityCard icon={Anchor} title="Fixed terms">
              Cutoff, maturity and the deposit fee are set once at initialization. The contract has no method to change them.
            </SecurityCard>
            <SecurityCard icon={Pause} title="Narrow admin powers">
              The owner can pause new deposits and trades, and withdraw deposit fees. Redemptions and settlement can never be paused.
            </SecurityCard>
          </div>
          <div className="lp-disclosure" role="note">
            <TriangleAlert size={18} aria-hidden />
            <div>
              <strong>Know the risks</strong>
              <p>
                This build runs on NEAR {cfg.network} and has not been audited. The contract account still holds a deployer key, so the code can be upgraded.
                YT pays zero if the rate does not rise above R0, and PT is not principal-protected if the rate falls.{' '}
                <Link to="/series">Read the full risk passport</Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-tint" id="faq" aria-labelledby="faq-title">
        <div className="lp-wrap lp-faq-grid">
          <SectionHead index="06" eyebrow="FAQ" title="Straight answers." id="faq-title">
            Still unsure? The Series page lists every rule and risk in full.
          </SectionHead>
          <div className="lp-faq">
            <Faq q="Where does the YT yield actually come from?">
              From NEAR staking rewards. Meta Pool stakes the NEAR behind stNEAR, and rewards raise the stNEAR rate. At settlement the contract gives YT holders
              the part of the deposited stNEAR that represents growth from R0 to RT. The seller gave that growth up in exchange for NEAR paid up front.
            </Faq>
            <Faq q="Can YT pay zero?">
              Yes. If RT is not above R0, YT redeems for nothing. If nobody captures the baseline before settlement, the contract uses RT as R0 and YT also pays
              zero, so capture it soon after the cutoff. Any account can.
            </Faq>
            <Faq q="Is my principal guaranteed?">
              No. PT redeems min(R0, RT) ÷ RT stNEAR per unit. When the rate rises, that is worth exactly R0 NEAR. If the rate ever falls below R0, PT holders absorb
              the difference.
            </Faq>
            <Faq q="Who settles the series, and when?">
              Anyone, any time after maturity, by calling request_settlement. The app shows a button for it. Redemption opens immediately after.
            </Faq>
            <Faq q="What does it cost?">
              Deposits pay a fee sized to the tenor, about 1% a year: {depositFees}. Fills pay {marketFee}, charged to the buyer. A one-time storage deposit
              registers your account with each series.
            </Faq>
            <Faq q="What do I need to start?">
              A NEAR wallet (MyNearWallet, Meteor or HOT) and some NEAR to stake. The app walks you through staking, depositing and registering for stNEAR payouts.
            </Faq>
          </div>
        </div>
      </section>

      <section className="lp-cta" aria-labelledby="cta-title">
        <div className="lp-wrap lp-cta-inner">
          <div>
            <span className="lp-mono-label">YieldForge on NEAR {cfg.network}</span>
            <h2 id="cta-title">Put a price on tomorrow’s yield.</h2>
          </div>
          <div className="lp-cta-actions">
            <Link className="lp-btn lp-btn-ink" to="/marketplace">
              Launch app <ArrowRight size={16} aria-hidden />
            </Link>
            <Link className="lp-btn lp-btn-outline" to="/calculator">
              Open calculator
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  )
}

function TrustItem({ icon: IconCmp, title, body }: { icon: Icon; title: string; body: string }) {
  return (
    <li>
      <IconCmp size={16} aria-hidden />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </li>
  )
}

function Stat({ label, value, unit, detail, accent = false }: { label: string; value: string; unit?: string; detail: string; accent?: boolean }) {
  return (
    <div className={`lp-stat ${accent ? 'lp-stat-accent' : ''}`}>
      <span>{label}</span>
      <strong>
        {value}
        {unit ? <small> {unit}</small> : null}
      </strong>
      <em>{detail}</em>
    </div>
  )
}

function SectionHead({ index, eyebrow, title, id, children }: { index: string; eyebrow: string; title: string; id: string; children: ReactNode }) {
  return (
    <div className="lp-head">
      <span className="lp-eyebrow">
        <b>{index}</b> {eyebrow}
      </span>
      <h2 id={id}>{title}</h2>
      <p>{children}</p>
    </div>
  )
}

function Step({ n, icon: IconCmp, title, children }: { n: string; icon: Icon; title: string; children: ReactNode }) {
  return (
    <li className="lp-step">
      <div className="lp-step-top">
        <span className="lp-step-icon" aria-hidden>
          <IconCmp size={18} />
        </span>
        <span className="lp-step-n">{n}</span>
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </li>
  )
}

function SecurityCard({ icon: IconCmp, title, children }: { icon: Icon; title: string; children: ReactNode }) {
  return (
    <article className="lp-sec">
      <span className="lp-sec-icon" aria-hidden>
        <IconCmp size={18} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  )
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="lp-faq-item">
      <summary>
        {q}
        <Plus size={16} aria-hidden />
      </summary>
      <p>{children}</p>
    </details>
  )
}

function Simulator({ rows, featuredId }: { rows: SeriesSnapshot[]; featuredId: string | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  const id = picked ?? featuredId ?? rows[0]?.contractId ?? null
  const d = rows.find((r) => r.contractId === id)?.display ?? null
  return (
    <>
      {rows.length > 1 && (
        <div className="lp-sim-tabs" role="group" aria-label="Series to simulate">
          {rows.map((r) => (
            <button key={r.contractId} type="button" className={r.contractId === id ? 'lp-sim-tab-on' : undefined} aria-pressed={r.contractId === id} onClick={() => setPicked(r.contractId)}>
              <strong>{tenorLabel(r.display)}</strong>
              <small>
                {r.display.id} · {r.display.phase}
              </small>
            </button>
          ))}
        </div>
      )}
      <SimulatorBody key={id ?? 'none'} r0={d?.baselineRate ?? d?.currentRate ?? null} baselineCaptured={d?.baselineRate != null} series={d} />
    </>
  )
}

function SimulatorBody({ r0, baselineCaptured, series }: { r0: number | null; baselineCaptured: boolean; series: SeriesDisplay | null }) {
  const [deposit, setDeposit] = useState('100')
  const [apr, setApr] = useState(7)
  const [price, setPrice] = useState('')

  const termDays = useMemo(() => {
    if (!series?.maturityMs) return 90
    const start = Math.max(Date.now(), series.cutoffMs ?? Date.now())
    return Math.max(1, Math.round((series.maturityMs - start) / DAY_MS))
  }, [series?.maturityMs, series?.cutoffMs])

  const result = useMemo(() => {
    const amountIn = Number(deposit)
    if (!series || r0 == null || !Number.isFinite(amountIn) || amountIn <= 0) return null
    const depositFee = Number(series.depositFeeBps) / 10_000
    const marketFee = Number(series.marketFeeBps) / 10_000
    const minted = amountIn * (1 - depositFee)
    const growth = (apr / 100) * (termDays / 365)
    const fair = r0 * growth
    const parsed = Number(price)
    const unit = price.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : fair
    const principalNear = amountIn * r0

    const proceeds = minted * unit
    const ptValue = minted * r0
    const sellerTotal = proceeds + ptValue
    const sellerReturn = sellerTotal / principalNear - 1

    const cost = minted * unit * (1 + marketFee)
    const payout = minted * r0 * growth
    const pnl = payout - cost
    const breakEvenApr = r0 > 0 ? ((unit * (1 + marketFee)) / r0) * (365 / termDays) * 100 : null

    return {
      minted,
      fair,
      unit,
      proceeds,
      ptValue,
      sellerTotal,
      sellerReturn,
      sellerApr: sellerReturn * (365 / termDays),
      cost,
      payout,
      pnl,
      roi: cost > 0 ? pnl / cost : null,
      leverage: cost > 0 ? ptValue / cost : null,
      breakEvenApr,
    }
  }, [deposit, apr, price, termDays, series, r0])

  return (
    <div className="lp-sim">
      <div className="lp-sim-inputs">
        <label className="lp-field">
          <span>Deposit</span>
          <div>
            <input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(',', '.'))} aria-label="Deposit amount in stNEAR" />
            <em>stNEAR</em>
          </div>
        </label>
        <label className="lp-field">
          <span>
            Expected staking APR <b>{fixed(apr, 1)}%</b>
          </span>
          <input className="lp-range" type="range" min={0} max={20} step={0.5} value={apr} onChange={(e) => setApr(Number(e.target.value))} aria-label="Expected staking APR" />
        </label>
        <label className="lp-field">
          <span>YT price</span>
          <div>
            <input inputMode="decimal" placeholder={result ? fixed(result.fair, 4) : '0'} value={price} onChange={(e) => setPrice(e.target.value.replace(',', '.'))} aria-label="YT price in NEAR" />
            <em>NEAR / YT</em>
          </div>
          <small>
            {result ? (
              <>
                Fair value at {fixed(apr, 1)}% APR: <b>{fixed(result.fair, 4)} NEAR</b>
                {price !== '' && (
                  <button type="button" onClick={() => setPrice('')}>
                    Use fair value
                  </button>
                )}
              </>
            ) : (
              'Rate unavailable'
            )}
          </small>
        </label>
        <dl className="lp-sim-terms">
          <div>
            <dt>{baselineCaptured ? 'Baseline R0' : 'R0 (live rate until captured)'}</dt>
            <dd>{r0 != null ? fixed(r0, 4) : '—'}</dd>
          </div>
          <div>
            <dt>Term</dt>
            <dd>{termDays} days</dd>
          </div>
          <div>
            <dt>You mint</dt>
            <dd>{result ? `${amount(result.minted)} PT + ${amount(result.minted)} YT` : '—'}</dd>
          </div>
        </dl>
      </div>

      <div className="lp-sim-out">
        <article className="lp-sim-card">
          <TokenBadge kind="PT" />
          <h3>If you sell the YT</h3>
          <dl>
            <SimRow label="NEAR received now" value={result ? `${amount(result.proceeds)} NEAR` : '—'} />
            <SimRow label="PT value at maturity" value={result ? `${amount(result.ptValue)} NEAR` : '—'} />
            <SimRow label="Total vs. principal" value={result ? `${signed(result.sellerReturn * 100)}%` : '—'} strong />
            <SimRow label="Fixed APR" value={result ? `${fixed(result.sellerApr * 100, 2)}%` : '—'} />
          </dl>
        </article>
        <article className="lp-sim-card lp-sim-card-dark">
          <TokenBadge kind="YT" />
          <h3>If you buy the YT</h3>
          <dl>
            <SimRow label="Cost incl. fee" value={result ? `${amount(result.cost)} NEAR` : '—'} />
            <SimRow label="Payout at maturity" value={result ? `${amount(result.payout)} NEAR` : '—'} />
            <SimRow
              label="Profit / loss"
              value={result ? `${signed(result.pnl, result.pnl !== 0 && Math.abs(result.pnl) < 1 ? 4 : 2)} NEAR${result.roi != null ? ` (${signed(result.roi * 100, Math.abs(result.roi) < 0.1 ? 1 : 0)}%)` : ''}` : '—'}
              strong
              tone={result ? (result.pnl < 0 ? 'neg' : 'pos') : undefined}
            />
            <SimRow label="Break-even APR" value={result?.breakEvenApr != null ? `${fixed(result.breakEvenApr, 2)}%` : '—'} />
            <SimRow label="Principal exposure" value={result?.leverage != null ? `${fixed(result.leverage, 1)}×` : '—'} />
          </dl>
        </article>
        <p className="lp-sim-note">
          Illustrative only. Assumes the rate grows at the APR you set and stays above R0; payouts are made in stNEAR and shown here in NEAR at RT. Not a forecast.
        </p>
      </div>
    </div>
  )
}

function SimRow({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: 'pos' | 'neg' }) {
  return (
    <div className={[strong ? 'lp-sim-strong' : '', tone ? `lp-sim-${tone}` : ''].join(' ').trim() || undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function SeriesCard({ row, live }: { row: SeriesSnapshot; live: boolean }) {
  const d = row.display
  const step = LIFECYCLE.findIndex((x) => x.phase === d.phase)
  const elapsed = d.cutoffMs != null && d.maturityMs != null ? Math.min(1, Math.max(0, (Date.now() - d.cutoffMs) / (d.maturityMs - d.cutoffMs))) : 0
  const status = d.depositsOpen
    ? `Deposits close in ${countdown(d.cutoffMs)}`
    : d.settled
      ? 'Settled · redemptions open'
      : d.matured
        ? 'Matured · awaiting settlement'
        : `Matures in ${countdown(d.maturityMs)}`
  return (
    <article className={`lp-series ${d.depositsOpen ? 'lp-series-open' : ''}`}>
      <div className="lp-series-head">
        <span className="lp-tenor">{tenorLabel(d)}</span>
        <div>
          <strong>{d.id}</strong>
          <small>{status}</small>
        </div>
        <span className={`lp-phase lp-phase-${d.phase === 'Paused' ? 'paused' : 'on'}`}>{d.phase}</span>
      </div>
      <ol className="lp-series-steps" aria-label={`Lifecycle: step ${step + 1} of ${LIFECYCLE.length}, ${LIFECYCLE[step]?.title ?? d.phase}`}>
        {LIFECYCLE.map((x, i) => (
          <li key={x.phase} className={i < step ? 'lp-step-done' : i === step ? 'lp-step-now' : undefined} title={x.title} />
        ))}
      </ol>
      <div className="lp-series-bar" aria-hidden>
        <i style={{ width: `${(elapsed * 100).toFixed(1)}%` }} />
      </div>
      <dl className="lp-series-rows">
        <div>
          <dt>Deposit cutoff</dt>
          <dd>{d.cutoffLabel}</dd>
        </div>
        <div>
          <dt>Maturity</dt>
          <dd>{d.maturityExactLabel}</dd>
        </div>
        <div>
          <dt>Baseline R0</dt>
          <dd>{d.baselineRate != null ? `${fixed(d.baselineRate, 4)} NEAR` : d.baselinePending ? 'Ready to capture' : 'At the cutoff'}</dd>
        </div>
        <div>
          <dt>Value locked</dt>
          <dd>{row.heldYocto != null ? `${amount(yoctoToNumber(row.heldYocto, 6))} stNEAR` : '—'}</dd>
        </div>
        <div>
          <dt>Deposit fee</dt>
          <dd>{formatBps(d.depositFeeBps)}</dd>
        </div>
        <div>
          <dt>Open listings</dt>
          <dd>{live ? row.listings.filter(isFillable).length : '—'}</dd>
        </div>
      </dl>
      <div className="lp-series-actions">
        {d.depositsOpen && (
          <Link className="lp-btn lp-btn-ink lp-btn-sm" to={withSeries('/earn', row.contractId)}>
            Deposit <ArrowRight size={13} aria-hidden />
          </Link>
        )}
        <Link className="lp-btn lp-btn-outline lp-btn-sm" to={withSeries('/marketplace', row.contractId)}>
          Trade YT
        </Link>
        {live && (
          <a className="lp-series-contract" href={explorerAccountUrl(row.contractId)} target="_blank" rel="noreferrer">
            Contract <ArrowUpRight size={12} aria-hidden />
          </a>
        )}
      </div>
    </article>
  )
}

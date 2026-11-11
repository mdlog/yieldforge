import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BookOpen, Code2, Rocket, ShieldCheck, TriangleAlert } from 'lucide-react'
import { NearMark, TokenBadge } from '@/components/ui'
import { LandingFooter, LandingNav } from '@/components/landing/LandingChrome'
import { explorerAccountUrl, getNearConfig, seriesContractIds } from '@/lib/near/config'
import { isLiveMode, viewAccessKeys, viewCall } from '@/lib/near/wallet'
import { LISTING_STORAGE_DEPOSIT_YOCTO } from '@/lib/contracts/marketplace'
import { useNearQuery } from '@/hooks/useNearQuery'
import { bySchedule, tenorLabel, useAllSeries } from '@/hooks/useAllSeries'
import { withSeries } from '@/contexts/SeriesContext'
import type { SeriesDisplay } from '@/hooks/useSeriesDisplay'
import { formatYocto } from '@/utils/format'
import { formatBps } from '@/utils/math'
// Official icons of the wallet modules the app enables (see WalletContext), taken from each
// @near-wallet-selector package's assets/ and downscaled to 96px WebP: they render at 22px.
import myNearWalletIcon from '@/assets/wallets/my-near-wallet-icon.webp'
import meteorWalletIcon from '@/assets/wallets/meteor-wallet-icon.webp'
import hotWalletIcon from '@/assets/wallets/hot-wallet-icon.webp'
import '@/styles/docs.css'

interface FtMetadata {
  name: string
  symbol: string
  icon: string | null
}

interface SeriesFacts {
  symbol: string | null
  /** Full-access keys on the series account; more than zero means its code can still be replaced. */
  fullAccessKeys: number | null
}

interface ChainFacts {
  stNear: FtMetadata | null
  stNearStorageMin: string | null
  ytStorageMin: string | null
  series: Record<string, SeriesFacts>
}

/** Token metadata, storage minimums and upgrade authority, read from the chain rather than written into the docs. */
async function fetchChainFacts(live: boolean): Promise<ChainFacts> {
  const cfg = getNearConfig()
  const ids = live ? seriesContractIds() : []
  const soft = <T,>(p: Promise<T>) => p.catch(() => null)
  const [stNear, stBounds, ytBounds, perSeries] = await Promise.all([
    soft(viewCall<FtMetadata>(cfg.stNearContractId, 'ft_metadata')),
    soft(viewCall<{ min: string }>(cfg.stNearContractId, 'storage_balance_bounds')),
    // Every series runs the same code, so one storage minimum stands for all of them.
    ids[0] ? soft(viewCall<{ min: string }>(ids[0], 'storage_balance_bounds')) : null,
    Promise.all(
      ids.map(async (id) => {
        const [meta, keys] = await Promise.all([soft(viewCall<FtMetadata>(id, 'ft_metadata')), soft(viewAccessKeys(id))])
        return [id, { symbol: meta?.symbol ?? null, fullAccessKeys: keys ? keys.filter((k) => k === 'FullAccess').length : null }] as const
      }),
    ),
  ])
  return { stNear, stNearStorageMin: stBounds?.min ?? null, ytStorageMin: ytBounds?.min ?? null, series: Object.fromEntries(perSeries) }
}

/** Only image data URLs from token metadata are rendered, and only through <img>. */
function safeIcon(icon: string | null | undefined): string | null {
  return typeof icon === 'string' && icon.startsWith('data:image/') ? icon : null
}

const WALLETS = [
  { name: 'MyNearWallet', icon: myNearWalletIcon },
  { name: 'Meteor Wallet', icon: meteorWalletIcon },
  { name: 'HOT Wallet', icon: hotWalletIcon },
]

const TOC: Array<{ group: string; items: Array<[id: string, label: string]> }> = [
  { group: 'Introduction', items: [['overview', 'Overview'], ['before-you-start', 'Before you start']] },
  { group: 'Concepts', items: [['tokens', 'PT and YT'], ['rates', 'Rates: R0 and RT'], ['lifecycle', 'Series lifecycle'], ['payouts', 'Payout math']] },
  {
    group: 'Guides',
    items: [['guide-deposit', 'Deposit stNEAR'], ['guide-sell', 'Sell YT'], ['guide-buy', 'Buy YT'], ['guide-settle', 'Baseline and settlement'], ['guide-redeem', 'Redeem PT and YT']],
  },
  { group: 'Reference', items: [['fees', 'Fees and limits'], ['contract', 'Contract methods'], ['events', 'Events'], ['deployments', 'Deployments']] },
  { group: 'Safety', items: [['security', 'Security model'], ['risks', 'Risks']] },
]
const SECTION_IDS = TOC.flatMap((g) => g.items.map(([id]) => id))

/** Highlights the section currently under the sticky nav. */
function useActiveSection(): string {
  const [active, setActive] = useState(SECTION_IDS[0]!)
  useEffect(() => {
    const onScroll = () => {
      let current = SECTION_IDS[0]!
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 120) current = id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return active
}

export default function DocsPage() {
  const live = isLiveMode()
  const cfg = getNearConfig()
  const all = useAllSeries()
  const rows = [...(all.data ?? [])].sort(bySchedule)
  const openRows = rows.filter((r) => r.display.depositsOpen)
  const active = useActiveSection()
  const pending = live && all.loading && !all.data ? '…' : '—'
  const first = rows[0]?.display ?? null
  const marketFee = first ? formatBps(first.marketFeeBps) : pending
  const minDeposit = first ? `${formatYocto(first.minDepositYocto, 2)} stNEAR` : pending
  const depositFees = rows.length ? rows.map((r) => `${formatBps(r.display.depositFeeBps)} (${tenorLabel(r.display)})`).join(', ') : pending
  const name = (d: SeriesDisplay) => `${tenorLabel(d)} · ${d.id}`
  const facts = useNearQuery(() => fetchChainFacts(live), [live])
  const factsPending = facts.loading ? '…' : '—'
  const near = (yocto: string | null | undefined) => (yocto ? `${formatYocto(yocto, 5)} NEAR` : factsPending)
  const ytStorage = near(facts.data?.ytStorageMin)
  const stNearStorage = near(facts.data?.stNearStorageMin)
  const stNearIcon = safeIcon(facts.data?.stNear?.icon)
  const stNearChip = <TokenChip icon={stNearIcon} label="stNEAR" />
  const keyCounts = Object.values(facts.data?.series ?? {}).map((f) => f.fullAccessKeys)
  const upgradeable = keyCounts.length && keyCounts.every((k) => k != null) ? keyCounts.filter((k) => (k ?? 0) > 0).length : null

  useEffect(() => {
    document.title = 'Docs · YieldForge'
    return () => {
      document.title = 'YieldForge — Tomorrow’s yield, today.'
    }
  }, [])

  return (
    <div className="lp docs">
      <LandingNav page="docs" />

      <header className="docs-hero">
        <div className="lp-wrap">
          <span className="lp-mono-label">Documentation</span>
          <h1>Learn how YieldForge works.</h1>
          <p>
            Everything you need to split stNEAR into PT and YT, trade yield on the fixed-price market, and redeem at maturity. Rules come from the series contract
            unless they are marked as app behavior; live values are read from the chain when the page loads.
          </p>
          <div className="docs-hero-chips">
            <NearChip label={`NEAR ${cfg.network}`} />
            {stNearChip}
            <TokenBadge kind="PT" size="sm" />
            <TokenBadge kind="YT" size="sm" />
            {rows.length > 0 && (
              <span className="docs-hero-phase">
                {rows.length} live series · {openRows.length} open for deposits
              </span>
            )}
          </div>
          <div className="docs-quick">
            <QuickCard href="#before-you-start" icon={Rocket} title="Get started" body="Wallet, staking and your first deposit." />
            <QuickCard href="#tokens" icon={BookOpen} title="Core concepts" body="PT, YT, R0, RT and the lifecycle." />
            <QuickCard href="#contract" icon={Code2} title="Contract reference" body="Every method, deposit and event." />
            <QuickCard href="#security" icon={ShieldCheck} title="Security and risks" body="What the code guarantees, and what it doesn’t." />
          </div>
        </div>
      </header>

      <div className="lp-wrap docs-layout">
        <aside className="docs-nav" aria-label="Documentation sections">
          <details className="docs-nav-mobile">
            <summary>On this page</summary>
            <TocList active={active} />
          </details>
          <div className="docs-nav-desktop">
            <TocList active={active} />
          </div>
        </aside>

        <article className="docs-content">
          <Section id="overview" eyebrow="Introduction" title="Overview">
            <p>
              YieldForge is a yield-tokenization protocol for Meta Pool stNEAR. Staking rewards raise the stNEAR exchange rate over time; YieldForge separates that
              growth from the principal so each part can be held or traded on its own.
            </p>
            <p className="docs-inline-chips">
              The underlying asset is {stNearChip} <span>({facts.data?.stNear?.name ?? 'Staked NEAR'}, issued by <code>{cfg.stNearContractId}</code>).</span>
            </p>
            <p>A deposit of stNEAR into a series mints two tokens one-for-one, net of the deposit fee:</p>
            <ul className="docs-token-list">
              <li>
                <TokenBadge kind="PT" /> <span>The principal side: worth R0 NEAR per unit at maturity when the rate has risen.</span>
              </li>
              <li>
                <TokenBadge kind="YT" /> <span>The yield side: all of the rate growth from R0 to RT, paid in stNEAR.</span>
              </li>
            </ul>
            <p>
              YT trades on a built-in fixed-price marketplace. Sellers lock in a return up front; buyers get leveraged exposure to NEAR staking yield. At maturity
              anyone records the final rate and every holder redeems directly from the contract.
            </p>
          </Section>

          <Section id="before-you-start" eyebrow="Introduction" title="Before you start">
            <ol className="docs-steps">
              <li>
                <strong>A NEAR wallet.</strong> The app connects through NEAR Wallet Selector with these wallets. Every transaction is signed in your wallet;
                YieldForge never holds keys.
                <ul className="docs-wallets">
                  {WALLETS.map((w) => (
                    <li key={w.name}>
                      <img src={w.icon} alt="" width={22} height={22} loading="lazy" />
                      {w.name}
                    </li>
                  ))}
                </ul>
              </li>
              <li>
                <strong>Some NEAR for gas and storage.</strong> Calls use 30–55 Tgas, and unused gas is refunded. Registering with a token contract costs a small one-time storage deposit (see{' '}
                <a href="#fees">Fees and limits</a>).
              </li>
              <li>
                <strong>stNEAR, if you want to deposit.</strong> The Deposit page can stake NEAR for you through Meta Pool’s <code>deposit_and_stake</code> (minimum 1
                NEAR). Buyers of YT only need NEAR.
                {rows.length > 0 && (
                  <span className="docs-live-note">
                    {openRows.length > 0
                      ? `Open for deposits now: ${openRows.map((r) => `${name(r.display)} until ${r.display.cutoffLabel}`).join('; ')}.`
                      : 'No series is open for deposits right now; YT of running series can still be bought and sold.'}
                  </span>
                )}
              </li>
            </ol>
            <Callout tone="info" title={`You are on NEAR ${cfg.network}`} icon={<NearMark className="docs-callout-near" />}>
              {cfg.network === 'testnet'
                ? 'Testnet tokens have no value. Get testnet NEAR from a faucet and use a testnet wallet account.'
                : 'Mainnet transactions move real funds. Start small.'}
            </Callout>
          </Section>

          <Section id="tokens" eyebrow="Concepts" title="PT and YT">
            <p>Both tokens live in the series contract and are minted in equal amounts on every deposit.</p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th scope="col">Token</th>
                    <th scope="col">Standard</th>
                    <th scope="col">Pays at redemption</th>
                    <th scope="col">Transfer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <TokenBadge kind="PT" size="sm" />
                    </td>
                    <td>Series ledger</td>
                    <td>
                      <code>min(R0, RT) ÷ RT</code> stNEAR per PT
                    </td>
                    <td>
                      <code>pt_transfer</code>; receiver must be registered
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <TokenBadge kind="YT" size="sm" />
                    </td>
                    <td>NEP-141 fungible token</td>
                    <td>
                      <code>max(RT − R0, 0) ÷ RT</code> stNEAR per YT
                    </td>
                    <td>
                      <code>ft_transfer</code>, or list it on the market
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The two payouts per unit always add up to exactly 1 stNEAR. Holding one PT and one YT is therefore the same as holding one stNEAR, and the contract can
              never owe more stNEAR than it holds.
            </p>
          </Section>

          <Section id="rates" eyebrow="Concepts" title="Rates: R0 and RT">
            <p>
              Both rates are the stNEAR → NEAR exchange rate read directly from Meta Pool’s <code>get_st_near_price</code> on <code>{cfg.stNearContractId}</code>. No
              third-party oracle is involved.
            </p>
            <dl className="docs-defs">
              <div>
                <dt>R0 — baseline</dt>
                <dd>
                  Recorded once by <code>capture_baseline</code>, which anyone can call after the deposit cutoff. Yield for YT is measured from this point, so it
                  should be captured promptly after the cutoff.
                </dd>
              </div>
              <div>
                <dt>RT — settlement</dt>
                <dd>
                  Recorded once by <code>request_settlement</code>, which anyone can call after maturity. Once stored it can never change, and redemptions open.
                </dd>
              </div>
            </dl>
            {rows.length > 0 && (
              <ul className="docs-live-note docs-live-list">
                {rows.map(({ contractId, display: d }) => (
                  <li key={contractId}>
                    <strong>{name(d)}</strong>{' '}
                    {d.baselineRate != null
                      ? `R0 = ${d.baselineRate.toFixed(6)} NEAR per stNEAR, recorded ${d.baselineCapturedLabel ?? 'on-chain'}.`
                      : d.baselinePending
                        ? 'cutoff passed, R0 not recorded yet: any account can call capture_baseline now.'
                        : `R0 is recorded after the cutoff on ${d.cutoffLabel}.`}
                    {d.settlementRate != null && ` RT = ${d.settlementRate.toFixed(6)} NEAR per stNEAR.`}
                  </li>
                ))}
              </ul>
            )}
            <Callout tone="warning" title="If nobody captures the baseline">
              When settlement happens without a recorded baseline, the contract uses RT as R0. YT then pays zero and PT holders receive all of the underlying stNEAR.
            </Callout>
          </Section>

          <Section id="lifecycle" eyebrow="Concepts" title="Series lifecycle">
            <p>
              Each series has its own dates, fixed when it is initialized; the contract has no method to change them. The last column shows where every live series
              is right now.
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th scope="col">Phase</th>
                    <th scope="col">Starts</th>
                    <th scope="col">What you can do</th>
                    <th scope="col">Series now</th>
                  </tr>
                </thead>
                <tbody>
                  <PhaseRow phase="Deposit open" rows={rows} starts="Series deployment" can="Deposit stNEAR, list and buy YT, transfer PT and YT" />
                  <PhaseRow phase="Awaiting baseline" rows={rows} starts="The series’ deposit cutoff" can="Anyone calls capture_baseline; trading continues" />
                  <PhaseRow phase="Active" rows={rows} starts="Baseline recorded" can="Trade YT; yield accrues to YT holders" />
                  <PhaseRow phase="Matured" rows={rows} starts="The series’ maturity date" can="Anyone calls request_settlement" />
                  <PhaseRow phase="Settled" rows={rows} starts="Settlement recorded" can="Redeem PT and YT for stNEAR, with no deadline" />
                </tbody>
              </table>
            </div>
            <p className="docs-note">
              The owner can pause the series at any time. Pausing stops new deposits, listings and fills only — never cancellations, settlement or redemptions.
            </p>
          </Section>

          <Section id="payouts" eyebrow="Concepts" title="Payout math">
            <p>At redemption the contract pays, per unit burned:</p>
            <pre className="docs-code">
              <code>{`PT  →  min(R0, RT) / RT   stNEAR   (worth R0 NEAR when RT ≥ R0)
YT  →  max(RT − R0, 0) / RT   stNEAR   (worth RT − R0 NEAR)`}</code>
            </pre>
            <p>
              <strong>Worked example.</strong> Deposit 100 stNEAR with a 0.25% fee → 99.75 PT + 99.75 YT. Suppose R0 = 3.20 and the rate rises 5% to RT = 3.36:
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table docs-table-num">
                <thead>
                  <tr>
                    <th scope="col">Holder</th>
                    <th scope="col">Per unit (stNEAR)</th>
                    <th scope="col">Total (stNEAR)</th>
                    <th scope="col">Value at RT (NEAR)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>99.75 PT</td>
                    <td>3.20 / 3.36 = 0.952381</td>
                    <td>95.0000</td>
                    <td>319.20</td>
                  </tr>
                  <tr>
                    <td>99.75 YT</td>
                    <td>0.16 / 3.36 = 0.047619</td>
                    <td>4.7500</td>
                    <td>15.96</td>
                  </tr>
                  <tr>
                    <td>Total</td>
                    <td>1.000000</td>
                    <td>99.7500</td>
                    <td>335.16</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              If the rate does not rise (RT ≤ R0), YT pays 0 and PT redeems 1 stNEAR per unit. PT is not principal-protected: if RT falls below R0, PT holders absorb
              the difference. Payouts round down, so the sum paid never exceeds the stNEAR held.
            </p>
          </Section>

          <Section id="guide-deposit" eyebrow="Guides" title="Deposit stNEAR">
            <ol className="docs-steps">
              <li>
                Open <Link to="/earn">Deposit &amp; sell</Link> and connect your wallet. Pick a series that is open for deposits. If you have no stNEAR,
                step 1 stakes NEAR with Meta Pool for you.
              </li>
              <li>
                In step 2, enter at least {minDeposit}. It shows the PT and YT you will receive after that series’ deposit fee ({depositFees}).
              </li>
              <li>
                Confirm. The app sends stNEAR’s <code>ft_transfer_call</code> to the series with 1 yoctoNEAR attached. Your account is registered for YT
                automatically.
              </li>
            </ol>
            <Callout tone={rows.length && !openRows.length ? 'warning' : 'info'} title="Each series closes at its own cutoff">
              Deposit &amp; sell only lists series that are open. After a series’ cutoff the app stops offering it for deposits, and the contract rejects any
              stNEAR sent directly; the stNEAR token contract then refunds it.
              {openRows.length > 0 && ` Open now: ${openRows.map((r) => `${name(r.display)} until ${r.display.cutoffLabel}`).join('; ')}.`}
            </Callout>
          </Section>

          <Section id="guide-sell" eyebrow="Guides" title="Sell YT (create a listing)">
            <ol className="docs-steps">
              <li>
                Step 3 of <Link to="/earn?step=sell">Deposit &amp; sell</Link> opens as soon as you hold YT (Portfolio has a <strong>Sell YT</strong> button per
                series too). Choose the quantity and the price per YT in NEAR; <strong>Use</strong> fills in a fair price at a 7% staking APR.
              </li>
              <li>
                <em className="docs-app-rule">App behavior</em> The listing can stay open for 1, 3, 7, 14, 30, 45 or 60 days, or until maturity, and never longer
                than maturity, so short series only show the shorter choices. After maturity the app stops publishing new listings. The contract itself only
                requires a future expiry.
              </li>
              <li>
                Confirm <code>create_listing</code>. The app attaches {formatYocto(LISTING_STORAGE_DEPOSIT_YOCTO, 2)} NEAR for the listing’s storage and the contract
                refunds anything above the exact cost. The YT moves into the contract’s escrow.
              </li>
              <li>
                When a buyer fills it, the NEAR for the filled quantity is sent to you in the same transaction. Partial fills are allowed. Cancel at any time to get
                unfilled YT back.
              </li>
            </ol>
            <p className="docs-note">You keep your PT. Selling all of your YT fixes your return: sale proceeds now plus R0 worth of stNEAR at maturity.</p>
          </Section>

          <Section id="guide-buy" eyebrow="Guides" title="Buy YT">
            <ol className="docs-steps">
              <li>
                Pick a listing on <Link to="/marketplace">Buy YT</Link>, which shows every series at once with its break-even APR. The price is fixed by the
                seller; there is no AMM and no slippage.
              </li>
              <li>
                Enter the quantity. You pay price × quantity plus the {marketFee} market fee. If your account has never held this YT, the app also attaches the
                one-time {ytStorage} storage registration.
              </li>
              <li>
                Confirm <code>buy</code>. The YT is delivered and the seller is paid in one atomic call; any excess NEAR is refunded.
              </li>
            </ol>
            <p className="docs-note">
              Check the break-even staking APR for a price with the <Link to="/#simulate">simulator on the home page</Link>, or compare a future-rate scenario with
              the <Link to="/calculator">Proceeds calculator</Link>. The most you can lose is what you paid.
            </p>
          </Section>

          <Section id="guide-settle" eyebrow="Guides" title="Baseline and settlement">
            <p>
              Two permissionless calls drive the series. In <Link to="/portfolio">Portfolio</Link>, any connected wallet sees a <strong>Capture baseline</strong> button
              once the cutoff has passed and R0 is missing; wallets holding a position see <strong>Request settlement</strong> after maturity.
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th scope="col">Call</th>
                    <th scope="col">When</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>capture_baseline</code>
                    </td>
                    <td>Once, after the cutoff</td>
                    <td>
                      Stores R0 from Meta Pool
                      {rows.map(({ contractId, display: d }) => (
                        <small key={contractId} className="docs-cell-live">
                          {tenorLabel(d)}: {d.baselineCapturedLabel ? `done · ${d.baselineCapturedLabel}` : `from ${d.cutoffLabel}`}
                        </small>
                      ))}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>request_settlement</code>
                    </td>
                    <td>Once, after maturity</td>
                    <td>
                      Stores RT; redemptions open
                      {rows.map(({ contractId, display: d }) => (
                        <small key={contractId} className="docs-cell-live">
                          {tenorLabel(d)}: {d.settled ? 'done' : `from ${d.maturityExactLabel}`}
                        </small>
                      ))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="docs-note">If Meta Pool’s rate cannot be read, nothing is stored and the call can simply be repeated.</p>
          </Section>

          <Section id="guide-redeem" eyebrow="Guides" title="Redeem PT and YT">
            <ol className="docs-steps">
              <li>
                Register to receive stNEAR: Portfolio shows <strong>Enable stNEAR payouts</strong> after maturity if you need it. It calls{' '}
                <code>storage_deposit</code> on <code>{cfg.stNearContractId}</code> ({stNearStorage}, once).
              </li>
              <li>
                Call <code>redeem_pt</code> or <code>redeem_yt</code> with 1 yoctoNEAR attached. The claim is burned first, then stNEAR is sent to you.
              </li>
              <li>If the stNEAR transfer fails, the burned claim is restored automatically and you can try again.</li>
            </ol>
            <p className="docs-note">
              Every holder redeems independently. There is no deadline and no queue, and nobody else’s actions — the seller’s included — affect your payout.
            </p>
          </Section>

          <Section id="fees" eyebrow="Reference" title="Fees and limits">
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Deposit fee</td>
                    <td>{depositFees}</td>
                    <td>Deducted from deposited stNEAR. Sized to the tenor (about 1% a year), set at initialization, at most 1%.</td>
                  </tr>
                  <tr>
                    <td>Market fee</td>
                    <td>{marketFee}</td>
                    <td>Paid by the buyer on top of the price; sent to the fee collector in the same call.</td>
                  </tr>
                  <tr>
                    <td>Minimum deposit</td>
                    <td>{minDeposit}</td>
                    <td>The Deposit page blocks smaller amounts; the contract rejects them and the stNEAR is refunded.</td>
                  </tr>
                  <tr>
                    <td>Listing storage</td>
                    <td>{formatYocto(LISTING_STORAGE_DEPOSIT_YOCTO, 2)} NEAR attached</td>
                    <td>Covers the listing’s on-chain storage; the contract refunds anything above the exact cost.</td>
                  </tr>
                  <tr>
                    <td>YT / PT registration</td>
                    <td>{ytStorage}, once</td>
                    <td>
                      Depositors are registered automatically; buyers pay it on their first fill. <span className="docs-cell-src">storage_balance_bounds</span>
                    </td>
                  </tr>
                  <tr>
                    <td>stNEAR registration</td>
                    <td>{stNearStorage}, once</td>
                    <td>
                      Needed once to receive stNEAR from redemptions. <span className="docs-cell-src">{cfg.stNearContractId}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Confirmation deposit</td>
                    <td>1 yoctoNEAR</td>
                    <td>Required on cancel, redeem and token transfers so the wallet must confirm.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="contract" eyebrow="Reference" title="Contract methods">
            <p>
              Each series is one account that is the vault, the YT token, the PT ledger and the marketplace (see <a href="#deployments">Deployments</a>).
              Every series runs the same code. Amounts are strings in yocto units (24 decimals); timestamps are nanoseconds.
            </p>
            <h3>Change methods</h3>
            <div className="docs-table-wrap">
              <table className="docs-table docs-table-ref">
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Caller</th>
                    <th scope="col">Attach</th>
                    <th scope="col">Effect</th>
                  </tr>
                </thead>
                <tbody>
                  <Method name="ft_transfer_call" args="on stNEAR → series, msg: “”" who="Depositor" attach="1 yocto" effect="Deposit before the cutoff; mints PT + YT net of the fee" />
                  <Method name="create_listing" args="quantity, unit_price, expires_at" who="YT holder" attach="storage" effect="Escrows YT and opens a fixed-price listing" />
                  <Method name="buy" args="listing_id, quantity" who="Anyone but the seller" attach="cost + fee (+ storage)" effect="Atomic fill; partial fills allowed; excess refunded" />
                  <Method name="cancel_listing" args="listing_id" who="Seller" attach="1 yocto" effect="Returns unfilled YT" />
                  <Method name="expire_listing" args="listing_id" who="Anyone, after expiry" attach="—" effect="Returns unfilled YT to the seller" />
                  <Method name="capture_baseline" args="" who="Anyone, after cutoff" attach="—" effect="Stores R0 once" />
                  <Method name="request_settlement" args="" who="Anyone, after maturity" attach="—" effect="Stores RT once" />
                  <Method name="redeem_pt / redeem_yt" args="amount" who="Holder, after settlement" attach="1 yocto" effect="Burns the claim and pays stNEAR" />
                  <Method name="pt_transfer" args="receiver_id, amount" who="PT holder" attach="1 yocto" effect="Moves PT to a registered account" />
                  <Method name="ft_transfer" args="receiver_id, amount, memo?" who="YT holder" attach="1 yocto" effect="NEP-141 YT transfer (not to the series itself)" />
                  <Method name="storage_deposit" args="account_id?, registration_only?" who="Anyone" attach={`≥ ${ytStorage}`} effect="NEP-145 registration for PT and YT" />
                  <Method name="pause / unpause" args="" who="Owner" attach="—" effect="Blocks or reopens deposits, listings and fills" />
                  <Method name="withdraw_fees" args="" who="Owner" attach="1 yocto" effect="Sends accumulated deposit fees to the fee collector" />
                </tbody>
              </table>
            </div>
            <h3>View methods</h3>
            <div className="docs-table-wrap">
              <table className="docs-table docs-table-ref">
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Returns</th>
                  </tr>
                </thead>
                <tbody>
                  <ViewMethod name="get_series" args="" returns="Terms, phase, R0/RT, supplies, fees and payouts per unit once settled" />
                  <ViewMethod name="get_position" args="account_id" returns="PT, YT, deposited stNEAR and whether it is redeemable" />
                  <ViewMethod name="preview_redeem" args="pt_amount, yt_amount" returns="stNEAR payouts for those amounts; null until settled" />
                  <ViewMethod name="get_listing / get_listings" args="listing_id | from_index, limit ≤ 100" returns="Listing terms, fills and status" />
                  <ViewMethod name="ft_balance_of / ft_total_supply / ft_metadata" args="account_id" returns="YT balance, supply and NEP-148 metadata" />
                  <ViewMethod name="pt_balance_of" args="account_id" returns="PT balance" />
                  <ViewMethod name="storage_balance_of / storage_balance_bounds" args="account_id" returns="NEP-145 registration state and minimum" />
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="events" eyebrow="Reference" title="Events">
            <p>
              The contract logs NEP-297 events as <code>EVENT_JSON</code> under the standard <code>yieldforge</code> v2.0.0, alongside the standard NEP-141{' '}
              <code>ft_mint</code>, <code>ft_burn</code> and <code>ft_transfer</code> events for YT.
            </p>
            <ul className="docs-chips">
              {[
                'series_created',
                'deposit_received',
                'listing_created',
                'listing_filled',
                'listing_cancelled',
                'listing_expired',
                'baseline_captured',
                'settlement_finalized',
                'claims_redeemed',
                'redemption_reverted',
                'pt_transfer',
                'contract_paused',
              ].map((e) => (
                <li key={e}>
                  <code>{e}</code>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="deployments" eyebrow="Reference" title="Deployments">
            <p>{live ? `Read from the app configuration and the chain just now (NEAR ${cfg.network}).` : 'Demo mode: no live contracts are configured.'}</p>
            <dl className="docs-kv">
              <KV label="Network" value={`NEAR ${cfg.network}`} icon={<NearLogo />} />
              <KV
                label={`Underlying · ${facts.data?.stNear?.name ?? 'Staked NEAR'}`}
                value={cfg.stNearContractId}
                href={explorerAccountUrl(cfg.stNearContractId)}
                mono
                icon={stNearIcon ? <img className="docs-token-img" src={stNearIcon} alt="" width={20} height={20} /> : undefined}
              />
            </dl>
            <div className="docs-table-wrap">
              <table className="docs-table docs-table-series">
                <thead>
                  <tr>
                    <th scope="col">Series</th>
                    <th scope="col">Phase</th>
                    <th scope="col">Deposit cutoff</th>
                    <th scope="col">Maturity</th>
                    <th scope="col">R0</th>
                    <th scope="col">Deposit fee</th>
                    <th scope="col">Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7}>{pending === '…' ? 'Reading the series from the chain…' : 'No series could be read.'}</td>
                    </tr>
                  ) : (
                    rows.map(({ contractId, display: d }) => {
                      const f = facts.data?.series[contractId]
                      return (
                        <tr key={contractId}>
                          <td>
                            <span className="docs-series-name">
                              <strong>{tenorLabel(d)}</strong> {d.id}
                            </span>
                            <small>{f?.symbol ?? factsPending}</small>
                          </td>
                          <td>{d.phase}</td>
                          <td>{d.cutoffLabel}</td>
                          <td>{d.maturityExactLabel}</td>
                          <td>{d.baselineRate != null ? d.baselineRate.toFixed(6) : d.baselinePending ? 'Ready to capture' : 'At cutoff'}</td>
                          <td>{formatBps(d.depositFeeBps)}</td>
                          <td>
                            {live ? (
                              <a href={explorerAccountUrl(contractId)} target="_blank" rel="noreferrer" title={contractId}>
                                Explorer <ArrowUpRight size={12} aria-hidden />
                              </a>
                            ) : (
                              'demo'
                            )}
                            <small>{f?.fullAccessKeys == null ? factsPending : f.fullAccessKeys > 0 ? 'upgradeable' : 'code locked'}</small>
                            <small>
                              <Link to={withSeries('/marketplace', contractId)}>open in app</Link>
                            </small>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="security" eyebrow="Safety" title="Security model">
            <ul className="docs-checks">
              <li>
                <strong>Fully collateralized.</strong> PT and YT payouts per unit add up to 1 stNEAR and round down, so total payouts never exceed the stNEAR held.
              </li>
              <li>
                <strong>Burn before pay.</strong> Claims are burned before stNEAR leaves the contract and restored if the transfer fails.
              </li>
              <li>
                <strong>Permissionless lifecycle.</strong> Anyone can capture the baseline and settle; the stored rates are immutable.
              </li>
              <li>
                <strong>One rate source.</strong> Rates come straight from Meta Pool’s <code>get_st_near_price</code>.
              </li>
              <li>
                <strong>Escrowed, atomic fills.</strong> Listed YT sits in the contract; a fill pays the seller and delivers YT in one call.
              </li>
              <li>
                <strong>Narrow admin powers.</strong> The owner can pause new deposits and trades and withdraw deposit fees. There is no admin path to user stNEAR, and
                redemptions cannot be paused.
              </li>
              <li>
                <strong>Fixed terms.</strong> Cutoff, maturity and the deposit fee are set at initialization and have no setter.
              </li>
            </ul>
            <p className="docs-note">
              Check these live on the <Link to="/">home page</Link>, which shows the collateral ratio read from the chain.
            </p>
          </Section>

          <Section id="risks" eyebrow="Safety" title="Risks">
            <Callout tone="danger" title="Read before you use real funds">
              <ul>
                <li>The contract has not been audited and currently runs on NEAR {cfg.network}.</li>
                <li>
                  {upgradeable === 0
                    ? 'No series account holds a full-access key, so their code can no longer be changed.'
                    : upgradeable != null
                      ? `${upgradeable} of ${keyCounts.length} series accounts still hold a full-access deployer key, so their code can be upgraded by the owner.`
                      : 'The series accounts still hold a full-access deployer key, so the code can be upgraded by its owner.'}
                </li>
                <li>YT pays zero if the rate does not rise above R0, or if the baseline is never captured.</li>
                <li>PT is not principal-protected if the stNEAR rate falls.</li>
                <li>Payouts are in stNEAR; converting to NEAR depends on Meta Pool unstaking or market liquidity.</li>
                <li>The marketplace has fixed-price listings only. A buyer may not exist when you want to exit.</li>
              </ul>
            </Callout>
            <div className="docs-next">
              <Link className="lp-btn lp-btn-ink" to="/marketplace">
                Launch app <ArrowRight size={15} aria-hidden />
              </Link>
              <Link className="lp-btn lp-btn-outline" to="/series">
                Full risk passport
              </Link>
            </div>
          </Section>
        </article>
      </div>

      <LandingFooter />
    </div>
  )
}

function TocList({ active }: { active: string }) {
  return (
    <>
      {TOC.map((group) => (
        <div key={group.group} className="docs-nav-group">
          <span>{group.group}</span>
          {group.items.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className={active === id ? 'docs-nav-active' : undefined}
              aria-current={active === id ? 'location' : undefined}
              // Collapse the mobile "On this page" menu once a section is picked.
              onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}
            >
              {label}
            </a>
          ))}
        </div>
      ))}
    </>
  )
}

function QuickCard({ href, icon: Icon, title, body }: { href: string; icon: typeof Rocket; title: string; body: string }) {
  return (
    <a className="docs-quick-card" href={href}>
      <Icon size={18} aria-hidden />
      <strong>{title}</strong>
      <span>{body}</span>
    </a>
  )
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="docs-section" aria-labelledby={`${id}-title`}>
      <span className="docs-eyebrow">{eyebrow}</span>
      <h2 id={`${id}-title`}>
        <a href={`#${id}`}>{title}</a>
      </h2>
      {children}
    </section>
  )
}

function Callout({ tone, title, icon, children }: { tone: 'info' | 'warning' | 'danger'; title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`docs-callout docs-callout-${tone}`} role="note">
      {icon ?? (tone === 'info' ? <BookOpen size={17} aria-hidden /> : <TriangleAlert size={17} aria-hidden />)}
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  )
}

function PhaseRow({ phase, rows, starts, can }: { phase: string; rows: Array<{ contractId: string; display: SeriesDisplay }>; starts: string; can: string }) {
  const here = rows.filter((r) => r.display.phase === phase)
  return (
    <tr className={here.length ? 'docs-row-now' : undefined}>
      <td>{phase}</td>
      <td>{starts}</td>
      <td>{can}</td>
      <td>
        {here.length
          ? here.map((r) => (
              <em key={r.contractId} className="docs-now">
                {tenorLabel(r.display)}
              </em>
            ))
          : '—'}
      </td>
    </tr>
  )
}

function Method({ name, args, who, attach, effect }: { name: string; args: string; who: string; attach: string; effect: string }) {
  return (
    <tr>
      <td>
        <code>{name}</code>
        {args && <small>{args}</small>}
      </td>
      <td>{who}</td>
      <td>{attach}</td>
      <td>{effect}</td>
    </tr>
  )
}

function ViewMethod({ name, args, returns }: { name: string; args: string; returns: string }) {
  return (
    <tr>
      <td>
        <code>{name}</code>
        {args && <small>{args}</small>}
      </td>
      <td>{returns}</td>
    </tr>
  )
}

function KV({ label, value, href, mono = false, icon }: { label: string; value: string; href?: string; mono?: boolean; icon?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={[mono ? 'lp-mono' : '', icon ? 'docs-kv-icon' : ''].join(' ').trim() || undefined}>
        {icon}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {value} <ArrowUpRight size={12} aria-hidden />
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

/** The NEAR logo in a dark disc, the way the token is usually shown. */
function NearLogo() {
  return (
    <span className="docs-near-logo" aria-hidden>
      <NearMark />
    </span>
  )
}

function NearChip({ label }: { label: string }) {
  return (
    <span className="docs-chip">
      <NearLogo />
      {label}
    </span>
  )
}

/** Token chip with the logo from the token's own on-chain metadata; falls back to the NEAR mark. */
function TokenChip({ icon, label }: { icon: string | null; label: string }) {
  return (
    <span className="docs-chip">
      {icon ? <img className="docs-token-img" src={icon} alt="" width={20} height={20} /> : <NearLogo />}
      {label}
    </span>
  )
}

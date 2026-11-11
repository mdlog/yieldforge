# YieldForge Frontend Plan

> **Historical note (2026-11-03):** this is the original build plan for the demo-only MVP. The app now also has a live mode wired to testnet contracts and real wallets — see `README.md` for the current architecture, contract calls, and known gaps, and `TODO.md` for status.

## Product scope

YieldForge adalah frontend marketplace NEAR-native untuk memperdagangkan hak atas future staking-yield appreciation dari stNEAR Meta Pool melalui fixed-price YT listings, dengan RFQ sederhana, PT/YT positions, maturity, redemption, Risk Passport, kalkulator, dan bukti transaksi. MVP ini adalah frontend demo: semua state berasal dari data dummy lokal yang diberi label jelas sebagai Demo mode, tanpa mengklaim data on-chain live atau buyer liquidity nyata.

## Implementation approach

- Stack: React + TypeScript + Vite, dengan data model lokal yang menyerupai contract/indexer responses.
- Shell: persistent left rail di desktop, compact top bar dan bottom navigation di mobile.
- Routes: `/` marketplace, `/series` series detail/Risk Passport, `/deposit`, `/create-listing`, `/listing/:id`, `/portfolio`, `/transactions/:id`.
- State: URL route + local React state untuk wallet connection, selected listing, calculator, modal/confirm flows, and demo transaction states.
- Data: `src/lib/demoData.ts` menyimpan series, listings, positions, transaction history, rate history, scenario rows, and explicit demo metadata.
- UI: reusable `AppShell`, `StatusPill`, `MetricCard`, `RateChart`, `RiskPassport`, `ListingRow`, `PositionCard`, `TransactionDrawer`, and `ConfirmModal` components.
- Accessibility: semantic buttons, visible focus states, descriptive labels, no icon-only actions without aria-label, keyboard-closeable overlays.
- Validation: TypeScript diagnostics via Webdev host, Vite production build, HTTP route manifest check, and read-only implementation review.

## Design direction

### Alternatives considered

- Quiet Swiss editorial finance terminal — probability 0.07.
- Near-future protocol console with luminous green accents — probability 0.06.
- Dense neo-brutalist trading room — probability 0.05.

### Chosen: Quiet Swiss editorial finance terminal

**Design Movement:** Swiss International Typographic Style interpreted for a modern DeFi operator console: asymmetry, disciplined type, deliberate whitespace, and hairline rules instead of decorative gradients.

**Core Principles:** 1) show the economic truth before the CTA; 2) treat risk copy as first-class interface content; 3) make open liquidity legible without manufacturing urgency; 4) use motion only to explain state change.

**Color Philosophy:** Warm bone (`#f3f1eb`) creates a paper-like reading surface; ink (`#151b1c`) keeps the product serious; a single acid-lime signature (`#d8f36b`) marks live/demo state and primary action; rust and blue are reserved for risk and neutral system status.

**Layout Paradigm:** A persistent 240px navigation rail paired with a wide editorial canvas. The main workspace uses a split reading column and a narrower action column rather than a centered dashboard grid. Tables become stacked, scrollable records on small screens.

**Signature Elements:** 1) a thin lime “signal line” that tags demo/live data; 2) black ink panels with reversed type for decisive moments; 3) oversized section indices (01, 02, 03) that make lifecycle stages navigable.

**Interaction Philosophy:** Browsing is open without a wallet. Mutating actions are gated with a clear connect state and always pass through a review step. Selecting a listing expands its context in-place or opens a route; cancellation and redemption are explicit, never hidden behind icon-only affordances.

**Animation:** 180–240ms ease-out transitions, opacity + 6px translate for drawers, no bouncing. Numbers use a short fade/slide when simulated state updates. Respect `prefers-reduced-motion`.

**Typography System:** Use `DM Sans` for body and UI, `Space Mono` for rates, hashes, IDs, and metadata. Large titles are tight, 700 weight; body copy stays 14–16px with 1.55 line-height. Use uppercase mono eyebrow labels sparingly.

**Brand Essence:** A transparent market for tomorrow’s staking yield, for stNEAR holders who want options today. Personality: exact, calm, candid.

**Brand Voice:** Headlines are direct and specific, not promotional. Example lines: “Sell the right, keep the principal claim.” / “No buyer is assumed until a fill happens.”

**Wordmark & Logo:** A compact split-chevron mark: two offset strokes forming a forward “Y” / yield fork, paired with the YieldForge wordmark in a custom-spaced grotesk treatment.

**Signature Brand Color:** Acid-lime `#d8f36b`, used as a precise system signal rather than decoration.

## Project structure

```
plan.md
TODO.md
package.json
vite.config.ts
tsconfig.json
index.html
app.config.ts
public/manus-routes.json
src/
  main.tsx              # app boot + global styles
  App.tsx               # route-aware shell and page composition
  styles.css            # design system, responsive layout, motion
  lib/demoData.ts       # dummy protocol/indexer state
  components/           # reusable UI primitives and drawers/modals
  pages/                # product screens
```

## Build workflow

1. Create the Vite/React TypeScript source and configure the route manifest.
2. Register host-managed TypeScript diagnostics before writing app code.
3. Implement desktop-first shell, then responsive mobile adaptations.
4. Add the complete lifecycle: browse → inspect risk → deposit preview → list YT → buy listing → portfolio → maturity/redemption evidence.
5. Run diagnostics and `pnpm build`, fix actionable issues, then start Vite on port 3000.
6. Verify `/manus-routes.json`, preview readiness, and final source against PRD. Commit the finished project to the managed repository.

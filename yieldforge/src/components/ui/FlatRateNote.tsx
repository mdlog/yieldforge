import { RiskCallout } from './RiskCallout'
import type { RateTrend } from '@/lib/near/stakingApr'
import { formatDate } from '@/utils/format'

/** Shown when the app's stNEAR price has stood still: YT then earns nothing until it moves. */
export function FlatRateNote({ app, reference }: { app: RateTrend; reference: RateTrend | null }) {
  return (
    <RiskCallout title="The testnet stNEAR rate is flat">
      The stNEAR price on <span className="mono">{app.contractId}</span> has not changed since at least {formatDate(app.fromMs)}. YT pays the
      rise of that rate above R0, so a testnet YT earns nothing unless it moves before maturity.
      {reference && ` On mainnet, Meta Pool's rate grew about ${reference.aprPercent.toFixed(1)}% a year over the last ${Math.round(reference.days)} days.`}
    </RiskCallout>
  )
}

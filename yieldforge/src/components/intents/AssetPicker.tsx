import { useMemo } from 'react'
import type { OneClickToken } from '@/lib/intents/flows'
import { chainLabel, groupTokens } from '@/lib/intents/oneclick'

/** Chain + asset selects over the 1Click token list, as one compact control; `label` names it for screen readers. */
export function AssetPicker({
  id,
  label,
  tokens,
  value,
  onChange,
  excludeChains = [],
  excludeAssetIds = [],
  disabled,
}: {
  id: string
  label: string
  tokens: OneClickToken[] | null
  value: OneClickToken | null
  onChange: (token: OneClickToken) => void
  excludeChains?: string[]
  excludeAssetIds?: string[]
  disabled?: boolean
}) {
  const groups = useMemo(
    () => (tokens ? groupTokens(tokens, { excludeAssetIds }).filter((g) => !excludeChains.includes(g.chain)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokens, excludeChains.join(','), excludeAssetIds.join(',')],
  )
  const chain = value?.blockchain ?? groups[0]?.chain ?? ''
  const inChain = groups.find((g) => g.chain === chain)?.tokens ?? []

  return (
    <div className="ac-picker" id={id} role="group" aria-label={label}>
      <select
        aria-label="Chain"
        value={chain}
        disabled={disabled || !tokens}
        onChange={(e) => {
          const first = groups.find((g) => g.chain === e.target.value)?.tokens[0]
          if (first) onChange(first)
        }}
      >
        {!tokens && <option>Loading chains…</option>}
        {groups.map((g) => (
          <option key={g.chain} value={g.chain}>
            {chainLabel(g.chain)}
          </option>
        ))}
      </select>
      <select
        aria-label="Asset"
        value={value?.assetId ?? ''}
        disabled={disabled || !tokens}
        onChange={(e) => {
          const t = inChain.find((x) => x.assetId === e.target.value)
          if (t) onChange(t)
        }}
      >
        {inChain.map((t) => (
          <option key={t.assetId} value={t.assetId}>
            {t.symbol}
          </option>
        ))}
      </select>
    </div>
  )
}

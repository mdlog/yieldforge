import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { OneClickToken } from '@/lib/intents/flows'
import { chainLabel, groupTokens } from '@/lib/intents/oneclick'
import { chainLogo } from '@/lib/intents/chainLogos'
import { chainInitials, typeaheadIndex } from '@/lib/intents/chainBadge'

/** A chain's logo, or its initials for the few chains without a published logo. */
export function ChainIcon({ chain }: { chain: string }) {
  const src = chainLogo(chain)
  return src ? <img className="ac-chain-icon" src={src} alt="" width={18} height={18} /> : <span className="ac-chain-icon ac-chain-badge" aria-hidden>{chainInitials(chainLabel(chain))}</span>
}

/**
 * The chain list as a select-only combobox, so each chain shows its logo (a native select can't). Arrow keys, Home/End,
 * Enter, Escape and type-ahead work as in a select.
 */
function ChainSelect({ chains, value, onChange, disabled, loading }: { chains: string[]; value: string; onChange: (chain: string) => void; disabled?: boolean; loading?: boolean }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const labels = useMemo(() => chains.map(chainLabel), [chains])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const show = () => {
    setActive(Math.max(0, chains.indexOf(value)))
    setOpen(true)
  }
  const choose = (i: number) => {
    const chain = chains[i]
    if (chain && chain !== value) onChange(chain)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        show()
      }
      return
    }
    const last = chains.length - 1
    if (e.key === 'ArrowDown') setActive((a) => Math.min(last, a + 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(last)
    else if (e.key === 'Enter' || e.key === ' ') choose(active)
    else if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'Tab') return setOpen(false)
    else if (e.key.length === 1 && /\S/.test(e.key)) setActive((a) => typeaheadIndex(labels, a, e.key))
    else return
    e.preventDefault()
  }

  return (
    <div className="ac-chain-select" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label="Chain"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {loading || !value ? (
          <span className="ac-chain-name">Loading chains…</span>
        ) : (
          <>
            <ChainIcon chain={value} />
            <span className="ac-chain-name">{chainLabel(value)}</span>
          </>
        )}
        <ChevronDown size={14} aria-hidden className="ac-chain-caret" />
      </button>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label="Chain" className="ac-chain-list">
          {chains.map((c, i) => (
            <li
              key={c}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={c === value}
              className={i === active ? 'is-active' : undefined}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <ChainIcon chain={c} />
              <span>{labels[i]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Chain + asset pickers over the 1Click token list, as one compact control; `label` names it for screen readers. */
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
  const chains = useMemo(() => groups.map((g) => g.chain), [groups])

  return (
    <div className="ac-picker" id={id} role="group" aria-label={label}>
      <ChainSelect
        chains={chains}
        value={chain}
        loading={!tokens}
        disabled={disabled || !tokens}
        onChange={(c) => {
          const first = groups.find((g) => g.chain === c)?.tokens[0]
          if (first) onChange(first)
        }}
      />
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

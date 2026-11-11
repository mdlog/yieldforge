import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { seriesContractIds, setActiveSeriesContract } from '@/lib/near/config'

interface SeriesContextValue {
  /** Every configured series contract, in display order. */
  seriesIds: string[]
  /** The series the app pages read from and transact with. */
  active: string
  select: (contractId: string) => void
}

const STORAGE_KEY = 'yieldforge.activeSeries'
const SeriesContext = createContext<SeriesContextValue | null>(null)

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function store(contractId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, contractId)
  } catch {
    // Private mode or blocked storage: the choice simply isn't remembered.
  }
}

/**
 * Holds the active series. A `?series=<contract>` link (listing pages, landing and docs buttons) selects
 * that series when the link is followed; otherwise the last choice is remembered, then the first series.
 */
export function SeriesProvider({ children }: { children: ReactNode }) {
  const seriesIds = useMemo(() => seriesContractIds(), [])
  const [params] = useSearchParams()
  const fromUrl = params.get('series')

  const [active, setActive] = useState(() => {
    const pick = [fromUrl, readStored()].find((id): id is string => !!id && seriesIds.includes(id)) ?? seriesIds[0]!
    setActiveSeriesContract(pick)
    return pick
  })
  // Follow a ?series= value only when it changes, so picking another series in the switcher sticks.
  const [seenUrl, setSeenUrl] = useState(fromUrl)
  if (fromUrl !== seenUrl) {
    setSeenUrl(fromUrl)
    if (fromUrl && fromUrl !== active && seriesIds.includes(fromUrl)) {
      setActiveSeriesContract(fromUrl)
      store(fromUrl)
      setActive(fromUrl)
    }
  }

  const select = useCallback(
    (contractId: string) => {
      if (!seriesIds.includes(contractId)) return
      setActiveSeriesContract(contractId)
      store(contractId)
      setActive(contractId)
    },
    [seriesIds],
  )

  const value = useMemo(() => ({ seriesIds, active, select }), [seriesIds, active, select])
  return <SeriesContext.Provider value={value}>{children}</SeriesContext.Provider>
}

export function useSeries(): SeriesContextValue {
  const ctx = useContext(SeriesContext)
  if (!ctx) throw new Error('useSeries must be used inside <SeriesProvider>')
  return ctx
}

/** App path pinned to a series, so shared links open the same series. */
export function withSeries(path: string, contractId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}series=${encodeURIComponent(contractId)}`
}

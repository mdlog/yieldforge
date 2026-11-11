import { useEffect, type RefObject } from 'react'

const SELECTOR = '[data-reveal], [data-reveal-stagger]'
const STAGGER_MS = 80
const SETTLE_MS = 1500

/**
 * Scroll-triggered reveals for the landing page: the "blur fade" pattern of Magic UI and beUI, in plain CSS.
 * Inside `root`:
 * - `data-reveal="up|left|right|zoom"` plays an element in once it scrolls into view;
 * - `data-reveal-stagger="up|left|right|zoom"` plays its direct children in one after another, and keeps
 *   `data-in` on itself for container effects (a line drawing across the steps, bars filling up).
 * Elements rendered later (series cards after the chain read) are picked up as they appear. Once played, the
 * reveal attributes are removed so the elements' own hover transitions work as before. With reduced motion,
 * or without IntersectionObserver, everything is shown at once.
 */
export function useScrollReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current
    if (!host) return
    const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true || !('IntersectionObserver' in window)

    const settle = (el: HTMLElement, items: HTMLElement[]) => {
      el.removeAttribute('data-reveal')
      el.removeAttribute('data-reveal-stagger')
      for (const item of items) item.style.removeProperty('--i')
    }
    const play = (el: HTMLElement) => {
      const items = el.hasAttribute('data-reveal-stagger') ? (Array.from(el.children) as HTMLElement[]) : []
      items.forEach((item, i) => item.style.setProperty('--i', String(i)))
      if (instant) {
        el.setAttribute('data-in', '')
        return settle(el, items)
      }
      // Two frames, so the hidden start state is painted before the transition begins.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.setAttribute('data-in', '')
          window.setTimeout(() => settle(el, items), SETTLE_MS + items.length * STAGGER_MS)
        }),
      )
    }

    const io = instant
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              io!.unobserve(entry.target)
              play(entry.target as HTMLElement)
            }
          },
          { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
        )
    const seen = new WeakSet<Element>()
    const watch = (el: HTMLElement) => {
      if (seen.has(el)) return
      seen.add(el)
      if (io) io.observe(el)
      else play(el)
    }
    const scan = (scope: Element) => {
      if (scope.matches(SELECTOR)) watch(scope as HTMLElement)
      scope.querySelectorAll<HTMLElement>(SELECTOR).forEach(watch)
    }
    scan(host)
    const mo = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((node) => node instanceof HTMLElement && scan(node))
    })
    mo.observe(host, { childList: true, subtree: true })
    return () => {
      io?.disconnect()
      mo.disconnect()
    }
  }, [root])
}

/** Lights the card under the pointer: sets --sx/--sy (pointer position) on the nearest `.lp-spot`. */
export function trackSpotlight(e: { target: EventTarget; clientX: number; clientY: number }) {
  const card = (e.target as HTMLElement).closest?.('.lp-spot') as HTMLElement | null
  if (!card) return
  const r = card.getBoundingClientRect()
  card.style.setProperty('--sx', `${e.clientX - r.left}px`)
  card.style.setProperty('--sy', `${e.clientY - r.top}px`)
}

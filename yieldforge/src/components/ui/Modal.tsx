import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Eyebrow } from './Panel'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Keep the latest onClose without re-running the effect (which would steal focus) on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      // Focus trap: wrap Tab / Shift+Tab inside the dialog.
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prevFocus?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-modal-title"
        aria-describedby={description ? 'review-modal-desc' : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close dialog">
          <X size={18} />
        </button>
        <div className="modal-header">
          <Eyebrow tone="lime">Review action</Eyebrow>
          <h2 id="review-modal-title">{title}</h2>
          {description && <p id="review-modal-desc">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

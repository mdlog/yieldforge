import { Copy } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'

export function CopyButton({ value, label, className = 'copy-receipt', iconOnly = false }: { value: string; label: string; className?: string; iconOnly?: boolean }) {
  const { push } = useToast()
  const copy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => push('Copied to clipboard.', 'success'))
      .catch(() => push('Clipboard is unavailable in this browser.', 'warning'))
  }
  return (
    <button type="button" className={className} onClick={copy} aria-label={label}>
      <Copy size={14} aria-hidden />
      {!iconOnly && ` ${label}`}
    </button>
  )
}

import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { getNearConfig } from '@/lib/near/config'

export function ExplorerLink({ children = 'View on explorer', href }: { children?: ReactNode; href?: string }) {
  return (
    <a href={href ?? getNearConfig().explorerUrl} target="_blank" rel="noreferrer" className="explorer-link">
      {children} <ExternalLink size={12} aria-hidden />
    </a>
  )
}

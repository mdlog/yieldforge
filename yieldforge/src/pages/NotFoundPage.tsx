import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button, Panel, Eyebrow, EmptyState } from '@/components/ui'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <>
      <div className="page-header">
        <div>
          <Eyebrow tone="rust">404</Eyebrow>
          <h1>Page not found</h1>
          <p>The page you’re looking for doesn’t exist or was moved.</p>
        </div>
      </div>
      <Panel>
        <EmptyState title="No page at this address" description="Return to the marketplace to continue browsing series and listings." action={<Button onClick={() => navigate('/marketplace')}>Back to marketplace <ArrowRight size={14} aria-hidden /></Button>} />
      </Panel>
    </>
  )
}

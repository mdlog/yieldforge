import { Component, type ReactNode, type ErrorInfo } from 'react'
import { friendlyTxError, isOnChainFailure, stringifyError } from '@/lib/near/tx'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[YieldForge] Unhandled error', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback

    const detail = stringifyError(error)
    const onChain = isOnChainFailure(detail)
    return (
      <div className="error-fallback" role="alert">
        <h1>{onChain ? 'Transaction rejected on-chain' : 'Something went wrong'}</h1>
        <p>
          {onChain
            ? friendlyTxError(detail)
            : 'The app encountered an unexpected error. Please refresh the page. If the problem persists, copy the details below for debugging.'}
        </p>
        <pre>{error.message}</pre>
        <div className="error-fallback-actions">
          <button className="button button-secondary button-sm" onClick={() => window.location.reload()}>
            Reload page
          </button>
          {onChain && (
            <button className="button button-secondary button-sm" onClick={() => this.setState({ error: null })}>
              Dismiss
            </button>
          )}
        </div>
      </div>
    )
  }
}

"use client";

import { Component } from 'react';
import { logger } from '../utils/logger';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('UI boundary failure', error.name, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex items-center justify-center min-h-[200px] p-8">
          <div className="bg-retro-panel border border-retro-error p-6 max-w-md text-center space-y-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto text-retro-error">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="text-retro-fg font-bold text-sm">Something went wrong</h3>
            <p className="text-xs text-retro-muted">Something unexpected happened. Try reloading.</p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="bg-retro-accent text-black px-4 py-2 text-xs font-bold hover:bg-retro-fg hover:text-retro-bg transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

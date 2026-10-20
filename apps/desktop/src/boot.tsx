import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'

/** Render the app — called by main.tsx only after initSecureStorage() settled. */
export function mount(): void {
  // Root markup mirrors orbit's layout.tsx (fonts moved to index.html links).
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="dark antialiased grain-overlay font-sans" style={{ colorScheme: 'dark' }}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[var(--z-modal)] focus:bg-retro-panel focus:text-retro-accent focus:px-4 focus:py-2 focus:text-xs focus:font-bold focus:border focus:border-border-glass focus:rounded-lg"
        >
          Skip to main content
        </a>
        <ConfirmProvider>
          <ToastProvider>
            <div className="flex-grow">
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </div>
          </ToastProvider>
        </ConfirmProvider>
      </div>
    </StrictMode>,
  )
  window.gmatch?.bootMark?.('renderer:mounted')
  // Two frames on purpose: the first commits the tree, the second runs after
  // that frame has painted. A single rAF measures before the paint, not after.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.gmatch?.bootMark?.('renderer:first-paint')),
    )
  }
}

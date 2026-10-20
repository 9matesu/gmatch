// Boot entry (security plan B.3): the app renders only after the secure-KV
// migration settles, so no module in App's graph reads localStorage while
// plaintext keys still sit in it. Browser/dev mode resolves immediately
// (localStorage passthrough).
import { initSecureStorage } from './utils/secure-storage'
import { logger } from './utils/logger'
import './globals.css'

// Nothing may vanish silently in a public release: renderer crashes ride the
// logger bridge (preload logError) into %APPDATA%\gMatch\main.log.
window.addEventListener('error', (e) => logger.error('window', e.error || e.message))
window.addEventListener('unhandledrejection', (e) => logger.error('rejection', e.reason))

initSecureStorage()
  .catch(() => { /* falls back to localStorage mode */ })
  .finally(() => {
    window.gmatch?.bootMark?.('secure-storage:ready')
    void import('./boot').then((m) => m.mount())
  })

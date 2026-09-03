import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Wave 2 mounts the real UI here.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div data-testid="goongrid-boot" />
  </StrictMode>,
)

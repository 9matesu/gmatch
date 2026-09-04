import { defineConfig } from 'vitest/config'

// Root workspace runs only the app's own suite; each package/app has its own
// vitest config (run via `npm run test:ws`).
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

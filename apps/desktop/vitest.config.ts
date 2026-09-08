import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Determinism: vitest only defaults NODE_ENV to 'test' when unset. A shell
// exporting NODE_ENV=production would flip import.meta.env.DEV to false and
// ship React's production build (no React.act) — pin it explicitly.
process.env.NODE_ENV = 'test'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Component tests opt into jsdom per-file via `// @vitest-environment jsdom`.
    coverage: {
      provider: 'v8',
      include: ['src/game/**', 'src/services/**', 'src/utils/routing.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
})

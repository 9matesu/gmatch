import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
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

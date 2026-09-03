import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so Electron can load dist/index.html over file://
export default defineConfig({
  plugins: [react()],
  base: './',
})

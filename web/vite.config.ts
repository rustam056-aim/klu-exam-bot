import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Calls to /api go to the local backend (wrangler dev on port 8787)
    proxy: { '/api': 'http://localhost:8787' },
  },
})

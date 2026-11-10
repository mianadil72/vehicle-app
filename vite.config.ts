import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the Express server (`npm run dev:api`).
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT || 3001}`,
    },
  },
})

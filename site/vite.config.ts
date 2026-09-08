import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served from wuwacalc.com's root via the custom domain, not the github.io/wuwa-calc-site/
  // subpath, so assets resolve from '/' for both dev and production builds.
  base: '/',
  plugins: [react()],
})

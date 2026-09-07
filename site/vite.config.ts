import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Project page (github.io/wuwa-calc/), not a user/org root page -- only needed for the
  // production build; the dev server stays at the root so localhost URLs don't change.
  base: command === 'build' ? '/wuwa-calc/' : '/',
  plugins: [react()],
}))

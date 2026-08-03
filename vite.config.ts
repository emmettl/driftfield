import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project site from /<repo>/, so assets need that prefix.
// Set BASE_PATH in the Pages workflow; local dev and previews stay at the root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})

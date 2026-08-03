import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default to Node. Everything worth testing here — the world step, the spawn
    // director, the scoring, the fluid's grid arithmetic — is deliberately free of
    // WebGL and the DOM, so the fast environment is also the only one needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

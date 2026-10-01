import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Lit's decorators need experimentalDecorators, which only tsconfig.test.json
  // sets. Without this esbuild compiles them as standard decorators and every
  // custom element throws "Unsupported decorator location: field".
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false }
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // jsdom, not 'node'. Every Lit component needs a DOM to render into, and
    // under 'node' none of the 31 components in src/renderer/src/components
    // could even be imported. The two tests that previously hand-rolled a fake
    // `document` with three methods now get a real one.
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts']
  }
})

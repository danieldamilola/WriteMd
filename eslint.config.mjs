import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'

export default defineConfig(
  // artifacts/ holds vendored reference snapshots (MonoCode, opencode) plus
  // scratch scripts. They are read for comparison, not maintained here, so
  // lint and prettier leave them alone.
  {
    ignores: ['**/node_modules', '**/dist', '**/out', 'scripts/**/*', 'artifacts/**/*']
  },
  tseslint.configs.recommended,
  eslintConfigPrettier
)

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'release*/**', '../../api-stage/**', 'node_modules/**', 'public/**', 'tools/**', 'tmp/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      // Vendored orbit shell stays verbatim (plan D1/D7). Orbit's own config
      // keeps these non-blocking; match that philosophy — new code is still
      // gated by the app's own strict root config.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['electron/**/*.cjs', 'src/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Node maintenance scripts (.mjs). Without this block they fell through to
    // js.configs.recommended with no globals, so `process`, `console` and
    // `fetch` all read as undefined.
    files: ['scripts/**/*.mjs', 'electron/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
      ecmaVersion: 2022,
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)

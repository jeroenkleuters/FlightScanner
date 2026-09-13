import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      prettier,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // The proxy runs on the server: Node globals, no browser and no React.
    files: ['api/**/*.ts', 'src/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The mock feed server: plain Node ESM on purpose, so no build step and no
    // dependency stands between a developer and a running feed. Untyped, which
    // is why it is linted rather than left unchecked.
    files: ['mock/**/*.mjs'],
    extends: [js.configs.recommended, prettier],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    files: ['*.config.{js,ts}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)

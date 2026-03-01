// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import stylistic from '@stylistic/eslint-plugin';
import unicorn from 'eslint-plugin-unicorn';

export default tseslint.config(
  // ─── Global ignores ──────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'docs-website/**',
      'native/**',
      'scripts/**',
      'expo-plugin/**',
      'examples/**',
      'coverage/**',
      '*.config.js',
      '*.config.mjs',
      'babel.config.js',
      'metro.config.js',
      'react-native.config.js',
    ],
  },

  // ─── Base JS recommended rules ──────────────────────────────────────
  eslint.configs.recommended,

  // ─── TypeScript recommended ──────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ─── Unicorn recommended ─────────────────────────────────────────────
  unicorn.configs['flat/recommended'],

  // ─── Source files ────────────────────────────────────────────────────
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/__tests__/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      '@stylistic': stylistic,
    },
    rules: {
      // ── TypeScript ──────────────────────────────────────────────────
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-this-alias': 'off', // Used in observable patterns
      '@typescript-eslint/ban-ts-comment': 'off',

      // ── Stylistic ──────────────────────────────────────────────────
      '@stylistic/type-annotation-spacing': 'warn',
      '@stylistic/member-delimiter-style': ['warn', {
        multiline: { delimiter: 'semi', requireLast: true },
        singleline: { delimiter: 'semi', requireLast: false },
      }],
      '@stylistic/type-generic-spacing': 'warn',
      '@stylistic/type-named-tuple-spacing': 'warn',

      // ── Unicorn (tuned for our project) ─────────────────────────────
      'unicorn/prevent-abbreviations': 'off', // db, fn, qb, etc. are fine
      'unicorn/no-null': 'off', // We use null throughout the DB layer
      'unicorn/no-array-reduce': 'off', // Reduce is fine for SQL builders
      'unicorn/no-array-for-each': 'off', // forEach is idiomatic for subscriptions
      'unicorn/prefer-module': 'off', // We have CJS require() for lazy loading
      'unicorn/prefer-top-level-await': 'off', // Not applicable in library code
      'unicorn/filename-case': ['warn', {
        cases: { camelCase: true, pascalCase: true },
      }],
      'unicorn/no-useless-undefined': 'off', // We use explicit undefined for clarity
      'unicorn/prefer-spread': 'off', // Array.from() with map is often clearer
      'unicorn/no-array-callback-reference': 'off', // Pointfree style is fine
      'unicorn/prefer-string-replace-all': 'warn',
      'unicorn/prefer-at': 'warn',
      'unicorn/prefer-negative-index': 'warn',
      'unicorn/no-lonely-if': 'warn',
      'unicorn/no-negated-condition': 'warn',
      'unicorn/prefer-ternary': 'off', // Ternaries can reduce readability
      'unicorn/switch-case-braces': ['warn', 'avoid'],
      'unicorn/catch-error-name': ['warn', { name: 'error' }],
      'unicorn/prefer-node-protocol': 'off', // Not relevant for RN library
      'unicorn/prefer-add-event-listener': 'off', // Worker onmessage is the standard pattern
      'unicorn/prefer-global-this': 'off', // Worker self is the standard pattern
      'unicorn/prefer-structured-clone': 'warn',
      'unicorn/prefer-type-error': 'warn',
      'unicorn/prefer-export-from': 'warn',
      'unicorn/import-style': 'off', // We have our own import conventions
      'unicorn/no-process-exit': 'off', // Not applicable

      // ── General ─────────────────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-duplicate-imports': 'off', // Handled by consistent-type-imports (separate type/value)
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['warn', 'multi-line'],
      'no-throw-literal': 'error',
      'no-case-declarations': 'warn',
      'no-empty': 'warn',

      // ── React Hooks ─────────────────────────────────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ─── Test files (relaxed) ────────────────────────────────────────────
  {
    files: ['src/**/__tests__/**/*.ts', 'src/**/__tests__/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/import-style': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/prefer-node-protocol': 'off',
      'unicorn/prefer-structured-clone': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/prefer-at': 'off',
      'unicorn/catch-error-name': 'off',
      'unicorn/prefer-add-event-listener': 'off',
      'unicorn/prefer-global-this': 'off',
      'unicorn/prefer-type-error': 'off',
    },
  },

  // ─── Prettier compatibility (must be last) ──────────────────────────
  eslintConfigPrettier,
);

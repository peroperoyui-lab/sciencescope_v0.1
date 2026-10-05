import js from '@eslint/js';
import globals from 'globals';

// Only rules that catch real problems; formatting belongs to Prettier.
export default [
  {
    files: ['app/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-shadow': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['app/ui/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];

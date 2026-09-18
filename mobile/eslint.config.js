// Flat config, which is the only format ESLint 9 reads.
//
// expo's own config supplies the React, React Native, hooks and import rules
// that match this project's runtime.
//
// There is deliberately no Prettier. The codebase is formatted consistently by
// hand and Prettier's line breaking disagrees with it across roughly six
// thousand lines, so adopting it would mean one reformat of every file for no
// behavioural gain. ESLint is here for defects, not for whitespace.

const expo = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'web-build/**',
      // Agent scratch, never part of the project.
      '.agents/**',
      '.claude/**',
      '.playwright-cli/**',
    ],
  },
  ...expo,
  {
    // Scoped to TypeScript, because that is where the plugin these rules come
    // from is registered. Applied globally they fail to resolve and ESLint
    // refuses to start at all.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // The codebase already holds itself to these; the point of naming them is
      // that the next change has to as well.
      //
      // `any` and unused bindings are currently at zero across app, components,
      // hooks and lib. Errors rather than warnings, because a warning in a
      // project whose CI does not fail on it is a comment.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Debug output that would otherwise reach a shipped bundle. There is none
    // today, and this is what keeps it that way.
    files: ['app/**', 'components/**', 'hooks/**', 'lib/**', 'theme/**'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Tests reach for the escape hatches deliberately: a mock is often typed
    // loosely on purpose, and asserting on a partial object is the point.
    files: ['__tests__/**', 'jest.setup.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      // jest.setup.js mocks native modules, which is the one place a require is
      // the right call: the factory must not be hoisted above the mock.
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
    },
  },
  {
    // axios ships both a default export and named exports of the same helpers,
    // and the rule cannot tell the two apart. `axios.create`,
    // `axios.isAxiosError` and `axios.AxiosError` off the default export are
    // the documented usage, so every report here is a false positive.
    rules: { 'import/no-named-as-default-member': 'off' },
  },
];

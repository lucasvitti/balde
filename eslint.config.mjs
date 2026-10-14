import featureContracts from './tools/feature-contracts-rule.mjs';
import globals from 'globals';
export default [
  {
    files: ['server.js', 'public/app.js', 'public/features/events.js'],
    plugins: { balde: { rules: { 'feature-contracts': featureContracts } } },
    rules: { 'balde/feature-contracts': 'error' }
  },
  { ignores: ['node_modules/**', 'public/vendor/**', 'public/assets/**'] },
  {
    files: ['server.js', 'src/**/*.mjs', 'tests/**/*.mjs', 'tools/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      'no-control-regex': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error'
    }
  },
  {
    files: ['public/app.js', 'public/dataProvider.js', 'public/session.js', 'public/features/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
    rules: {
      'no-control-regex': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error'
    }
  }
];

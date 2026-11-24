import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'tools/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.es2021,
                // GJS / GNOME Shell globals
                console: 'readonly',
                global: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
                TextDecoder: 'readonly',
                TextEncoder: 'readonly',
            },
        },
        rules: {
            // GNOME style keeps `GObject.registerClass([{…},] class Foo …)` bodies unindented.
            'indent': ['error', 4, {
                ignoredNodes: [
                    'CallExpression[callee.object.name=GObject][callee.property.name=registerClass] > ClassExpression',
                ],
            }],
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
            'comma-dangle': ['error', 'always-multiline'],
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            // Security (docs/security/secure-development.md)
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-script-url': 'error',
        },
    },
    {
        // ADR 0004: the pure core must stay importable from Node. src/shared is also the
        // desktop app's (ADR 0006), so no Tauri imports there either.
        files: [
            'src/shared/**/*.js', 'src/lib/config.js', 'src/lib/updates.js',
            'tools/installer/lib/plan.js',
        ],
        rules: {
            'no-restricted-imports': ['error', {patterns: ['gi://*', 'resource://*', '@tauri-apps/*']}],
        },
    },
    {
        // The desktop app (ADR 0006).
        files: ['desktop/src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {...globals.browser, __APP_VERSION__: 'readonly'},
        },
        rules: {
            'indent': ['error', 4],
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
            'comma-dangle': ['error', 'always-multiline'],
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-script-url': 'error',
            // Shared code only from src/shared: src/lib may pull in GNOME (config.js is plain).
            'no-restricted-imports': ['error', {patterns: [{
                group: ['@lib/*', '!@lib/config.js', '**/src/lib/*'],
                message: 'Import shared code from @shared; only @lib/config.js is allowed from src/lib.',
            }]}],
            // API text goes in with textContent.
            'no-restricted-properties': ['error',
                {property: 'innerHTML', message: 'Use textContent or DOM nodes (untrusted data).'},
                {property: 'outerHTML', message: 'Use textContent or DOM nodes (untrusted data).'}],
        },
    },
    {
        files: ['desktop/vite.config.js'],
        languageOptions: {ecmaVersion: 2022, sourceType: 'module', globals: globals.node},
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node,
        },
    },
];

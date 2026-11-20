// `@core` points at ../src/lib, so the desktop app uses the same code as the extension.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const core = fileURLToPath(new URL('../src/lib', import.meta.url));
// The version comes from the root package.json.
const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export default defineConfig({
    clearScreen: false,
    resolve: {alias: {'@core': core}},
    define: {__APP_VERSION__: JSON.stringify(version)},
    server: {
        port: 1420,
        strictPort: true,
        // Let Vite serve ../src/lib in development.
        fs: {allow: ['..']},
    },
    build: {
        target: 'safari16',
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('index.html', import.meta.url)),
                popover: fileURLToPath(new URL('popover.html', import.meta.url)),
            },
        },
    },
});

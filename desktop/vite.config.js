// `@shared` points at ../src/shared, the GNOME-free modules the Ubuntu extension uses too, so
// the desktop app runs the same code. `@lib` is ../src/lib, only for its build-time config.js.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const shared = fileURLToPath(new URL('../src/shared', import.meta.url));
const lib = fileURLToPath(new URL('../src/lib', import.meta.url));
// The version comes from the root package.json.
const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export default defineConfig({
    clearScreen: false,
    resolve: {alias: {'@shared': shared, '@lib': lib}},
    define: {__APP_VERSION__: JSON.stringify(version)},
    server: {
        port: 1420,
        strictPort: true,
        // Let Vite serve ../src/shared and ../src/lib in development.
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

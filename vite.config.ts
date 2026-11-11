import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

// `vite build --mode public` (npm run build:public): la pagina cliente e la pagina parts. Admin, debug, bend test
// e spec si usano in locale (SPEC §7).
const PUBLIC_PAGES = ['index', 'parts'];
const ALL_PAGES: Record<string, string> = {
  index: 'index.html',
  parts: 'parts.html',
  admin: 'admin.html',
  debug: 'debug.html',
  bendTest: 'bend-test.html',
  spec: 'spec.html',
};

export default defineConfig(({ command, isPreview, mode }) => ({
  // GitHub Pages serve il sito da https://vongomben.github.io/sign-configurator/
  base: command === 'build' || isPreview ? '/sign-configurator/' : '/',
  appType: 'mpa',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: Object.fromEntries(
        Object.entries(ALL_PAGES)
          .filter(([name]) => mode !== 'public' || PUBLIC_PAGES.includes(name))
          .map(([name, file]) => [name, resolve(root, file)]),
      ),
    },
  },
  // Il pre-bundling sposterebbe manifold.js in .vite/deps, rompendo il suo
  // new URL('manifold.wasm', import.meta.url): l'URL del .wasm lo passiamo noi.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
}));

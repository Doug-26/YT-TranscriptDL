import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'dist', 'extension');

await mkdir(path.join(outDir, 'content'), { recursive: true });
await mkdir(path.join(outDir, 'background'), { recursive: true });

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['chrome120'],
  logLevel: 'info',
};

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(__dirname, 'src/content/content.ts')],
    outfile: path.join(outDir, 'content/content.js'),
    format: 'iife',
    platform: 'browser',
  }),
  build({
    ...common,
    entryPoints: [path.join(__dirname, 'src/background/service-worker.ts')],
    outfile: path.join(outDir, 'background/service-worker.js'),
    format: 'esm',
    platform: 'browser',
  }),
]);

console.log('[esbuild] content + service worker bundled →', path.relative(__dirname, outDir));

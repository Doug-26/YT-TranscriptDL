import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '..', 'dist');

await rm(target, { recursive: true, force: true });
console.log('[clean] removed', path.relative(path.join(__dirname, '..'), target));

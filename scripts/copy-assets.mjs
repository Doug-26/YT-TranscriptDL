import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', 'extension');

await mkdir(path.join(dist, 'content'), { recursive: true });
await mkdir(path.join(dist, 'icons'), { recursive: true });

// manifest.json → dist/extension/manifest.json
await copyFile(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
console.log('[copy] manifest.json');

// content.css → dist/extension/content/content.css
await copyFile(
  path.join(root, 'src', 'content', 'content.css'),
  path.join(dist, 'content', 'content.css'),
);
console.log('[copy] content/content.css');

// icons/* → dist/extension/icons/*
const iconsSrc = path.join(root, 'public', 'icons');
if (existsSync(iconsSrc)) {
  const entries = await readdir(iconsSrc);
  await Promise.all(
    entries.map((name) =>
      copyFile(path.join(iconsSrc, name), path.join(dist, 'icons', name)),
    ),
  );
  console.log('[copy] icons (' + entries.length + ' files)');
} else {
  console.warn('[copy] no icons found at public/icons — manifest will reference missing files');
}

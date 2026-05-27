/**
 * Pure-Node PNG icon generator. Produces 16/32/48/128 px placeholder icons
 * — a rounded red square with a white "download" glyph — into public/icons/.
 * Replace these files with real artwork when ready.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');
await mkdir(outDir, { recursive: true });

const RED = [0xcc, 0x00, 0x00];
const WHITE = [0xff, 0xff, 0xff];

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crc32Table();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function pixelColor(x, y, size) {
  // Coordinates normalized to a 100×100 design grid
  const nx = (x / size) * 100;
  const ny = (y / size) * 100;

  // Rounded corners — drop pixels outside corner radius (alpha = 0)
  const r = 18;
  const inCorner = (cx, cy) => {
    const dx = nx - cx;
    const dy = ny - cy;
    return Math.sqrt(dx * dx + dy * dy) > r;
  };
  if (
    (nx < r && ny < r && inCorner(r, r)) ||
    (nx > 100 - r && ny < r && inCorner(100 - r, r)) ||
    (nx < r && ny > 100 - r && inCorner(r, 100 - r)) ||
    (nx > 100 - r && ny > 100 - r && inCorner(100 - r, 100 - r))
  ) {
    return null; // transparent
  }

  // Glyph: vertical bar
  const inBar = nx >= 44 && nx <= 56 && ny >= 22 && ny <= 56;
  // Arrow head triangle
  const inHead = pointInTriangle(nx, ny, 30, 50, 70, 50, 50, 76);
  // Base line
  const inBase = nx >= 22 && nx <= 78 && ny >= 82 && ny <= 88;

  if (inBar || inHead || inBase) return WHITE;
  return RED;
}

function generatePNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const color = pixelColor(x + 0.5, y + 0.5, size);
      const i = y * rowBytes + 1 + x * 4;
      if (color) {
        raw[i] = color[0];
        raw[i + 1] = color[1];
        raw[i + 2] = color[2];
        raw[i + 3] = 0xff;
      } else {
        raw[i] = 0;
        raw[i + 1] = 0;
        raw[i + 2] = 0;
        raw[i + 3] = 0; // transparent
      }
    }
  }

  const idat = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const png = generatePNG(size);
  const file = path.join(outDir, `icon-${size}.png`);
  await writeFile(file, png);
  console.log(`[icons] wrote icon-${size}.png (${png.length} bytes)`);
}

// Rasterize build/icon.svg -> build/icon.png (512) + build/icon.ico (multi-size).
// Uses sharp (already a dependency). The .ico embeds PNGs (valid on Windows Vista+),
// so no native ICO encoder / extra dependency is needed.
//
// Run: node scripts/make-icon.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(root, 'build', 'icon.svg'));

// Sizes packed into the .ico (Windows picks the best per context).
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function pngBuffer(size) {
  // Re-render the SVG at each size for crisp edges (not a downscale of one bitmap).
  return sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain' }).png().toBuffer();
}

/** Build an ICO container around already-encoded PNG buffers. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4); // image count

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  const dirEntries = entries.map((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 0); // width  (0 = 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1); // height (0 = 256)
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, o + 8); // size of image data
    dir.writeUInt32LE(offset, o + 12); // offset of image data
    offset += e.png.length;
    return e.png;
  });

  return Buffer.concat([header, dir, ...dirEntries]);
}

const buffers = await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, png: await pngBuffer(size) })),
);

writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco(buffers));

// 512px PNG for electron-builder (Linux/mac fallback) + previews.
await sharp(svg, { density: 512 }).resize(512, 512).png().toFile(path.join(root, 'build', 'icon.png'));

// 256px preview so the result can be eyeballed.
await sharp(svg, { density: 512 }).resize(256, 256).png().toFile(path.join(root, 'build', 'icon-preview.png'));

console.log(`Wrote build/icon.ico (${ICO_SIZES.join(', ')}px), build/icon.png (512px), build/icon-preview.png`);

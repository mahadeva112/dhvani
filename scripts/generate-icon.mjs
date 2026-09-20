import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/**
 * Generates the DHVANI app icon as a 1024x1024 PNG.
 *
 * Written by hand rather than committed as a binary so the mark stays
 * reviewable in diffs and regenerable at any size. electron-builder converts
 * this single PNG into .ico and .icns automatically.
 *
 *   node scripts/generate-icon.mjs
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Each output and the size it is rendered at. */
const TARGETS = [
  // electron-builder converts this one into .ico and .icns.
  { file: path.join(ROOT, 'desktop', 'icons', 'icon.png'), size: 1024 },
  // Browser tab icon for the web and Docker distributions.
  { file: path.join(ROOT, 'public', 'favicon.png'), size: 256 },
];

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

const lerp = (a, b, t) => a + (b - a) * t;

/** Mixes a colour over a destination with the given alpha. */
const blend = (dst, offset, [r, g, b], alpha) => {
  const a = clamp01(alpha);
  if (a <= 0) return;
  dst[offset] = Math.round(lerp(dst[offset], r, a));
  dst[offset + 1] = Math.round(lerp(dst[offset + 1], g, a));
  dst[offset + 2] = Math.round(lerp(dst[offset + 2], b, a));
  dst[offset + 3] = Math.round(lerp(dst[offset + 3], 255, a));
};

/**
 * Signed distance to a rounded rectangle, used to antialias the app tile.
 * Negative inside, positive outside.
 */
const roundedRectDistance = (x, y, cx, cy, halfW, halfH, radius) => {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
};

/** Converts a signed distance into a 0..1 coverage value (1px feather). */
const coverage = (distance) => clamp01(0.5 - distance);

/* ------------------------------------------------------------------ */
/* The mark                                                            */
/* ------------------------------------------------------------------ */

const render = (SIZE) => {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4); // transparent

  const center = SIZE / 2;
  const tileHalf = SIZE * 0.44;
  const tileRadius = SIZE * 0.22;

  // Brand gradient: indigo -> cyan, matching the header mark in the web UI.
  const from = [79, 70, 229]; // indigo-600
  const mid = [99, 102, 241]; // indigo-500
  const to = [34, 211, 238]; // cyan-400

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const offset = (y * SIZE + x) * 4;

      const tile = coverage(roundedRectDistance(x, y, center, center, tileHalf, tileHalf, tileRadius));
      if (tile <= 0) continue;

      // Diagonal gradient across the tile.
      const t = clamp01((x / SIZE) * 0.55 + (1 - y / SIZE) * 0.45);
      const colour =
        t < 0.5
          ? from.map((c, i) => lerp(c, mid[i], t * 2))
          : mid.map((c, i) => lerp(c, to[i], (t - 0.5) * 2));

      blend(pixels, offset, colour, tile);
    }
  }

  /*
   * Concentric broadcast arcs plus a centre dot — the same "radio" idea as the
   * in-app logo, which reads clearly even at 16px in a taskbar.
   */
  const white = [255, 255, 255];
  const rings = [
    { radius: SIZE * 0.085, thickness: SIZE * 0.085, alpha: 1 }, // solid core
    { radius: SIZE * 0.175, thickness: SIZE * 0.035, alpha: 0.95 },
    { radius: SIZE * 0.255, thickness: SIZE * 0.032, alpha: 0.75 },
    { radius: SIZE * 0.33, thickness: SIZE * 0.028, alpha: 0.5 },
  ];

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const offset = (y * SIZE + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const distance = Math.hypot(dx, dy);

      for (const ring of rings) {
        // Outer rings are drawn as left/right arcs, leaving a gap top and
        // bottom so the mark reads as sound rather than as a target.
        if (ring.thickness < SIZE * 0.06) {
          const angle = Math.abs(Math.atan2(dy, dx));
          const fromHorizontal = Math.min(angle, Math.PI - angle);
          if (fromHorizontal > Math.PI * 0.34) continue;
        }

        const band = Math.abs(distance - ring.radius) - ring.thickness / 2;
        const alpha = coverage(band) * ring.alpha;
        if (alpha > 0) blend(pixels, offset, white, alpha);
      }
    }
  }

  return Buffer.from(pixels.buffer);
};

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const encodePng = (rgba, width, height) => {
  // Each scanline is prefixed with a filter byte; 0 means "no filter".
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/* ------------------------------------------------------------------ */

for (const { file, size } of TARGETS) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const png = encodePng(render(size), size, size);
  fs.writeFileSync(file, png);
  console.log(
    `Wrote ${path.relative(ROOT, file)} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`
  );
}

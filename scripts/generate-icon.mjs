import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Builds every DHVANI app icon from the one logo in desktop/icon-source.png
 * (rendered from desktop/icon-source.svg).
 *
 * The source sits outside desktop/icons/ so the full-size artwork is not
 * shipped inside the app. To change the logo, replace that file (any square
 * image with a transparent background; it need not be square) and run:
 *
 *   npm run icon
 *
 * The empty margin around the logo is trimmed so the tile fills the icon the
 * way other taskbar icons do. Downscaling is an area average in premultiplied
 * alpha, so the soft edge of the tile does not pick up a dark fringe at 16px.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'desktop', 'icon-source.png');

/** How much of the icon square the logo's visible tile should fill. The
 * whole square, like the other taskbar icons: any margin left here shows up
 * as a smaller icon next to them. */
const FILL = 1;

/** PNG outputs and the size each is rendered at. */
const PNG_TARGETS = [
  // The .icns for macOS and the Linux icon are converted from this one, and
  // the loading screen and About window show it.
  { file: path.join(ROOT, 'desktop', 'icons', 'icon.png'), size: 1024 },
  // Browser tab icon for the web and Docker distributions.
  { file: path.join(ROOT, 'public', 'favicon.png'), size: 256 },
  // Icons in public/manifest.webmanifest: what Chrome puts on the taskbar and
  // in the Start menu when the browser version is installed as an app. The
  // app's own header and welcome window show the 192 one.
  { file: path.join(ROOT, 'public', 'icon-192.png'), size: 192 },
  { file: path.join(ROOT, 'public', 'icon-512.png'), size: 512 },
];

/**
 * Windows icon: the .exe, taskbar, Start menu and title bar. Each size is
 * drawn from the source rather than left to Windows to shrink the 256 one;
 * 20 and 40 are what the taskbar asks for at 125% display scaling.
 */
const ICO_FILE = path.join(ROOT, 'desktop', 'icons', 'icon.ico');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/* ------------------------------------------------------------------ */
/* Reading the source                                                  */
/* ------------------------------------------------------------------ */

/** Decodes the source to raw RGBA with the bundled ffmpeg. */
const decodeSource = () => {
  const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
  if (!ffmpeg) throw new Error('ffmpeg-static is not installed; run npm install first.');

  const header = fs.readFileSync(SOURCE);
  if (header.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${SOURCE} is not a PNG.`);
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);

  const rgba = execFileSync(
    ffmpeg,
    ['-v', 'error', '-i', SOURCE, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'],
    { maxBuffer: width * height * 4 + 1024 }
  );
  return { rgba, width, height };
};

/** The square, centred on the visible logo, that the logo fills by FILL. */
const logoSquare = ({ rgba, width, height }) => {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error(`${SOURCE} is fully transparent.`);

  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) / FILL;
  return { left: (x0 + x1 + 1) / 2 - side / 2, top: (y0 + y1 + 1) / 2 - side / 2, side };
};

/* ------------------------------------------------------------------ */
/* Resampling                                                          */
/* ------------------------------------------------------------------ */

/**
 * For each output pixel along one axis, the source pixels it covers and how
 * much of each. Source pixels outside the image count as transparent.
 */
const areaWeights = (start, span, size, limit) => {
  const scale = span / size;
  const rows = [];
  for (let i = 0; i < size; i += 1) {
    const from = start + i * scale;
    const to = from + scale;
    const taps = [];
    for (let s = Math.floor(from); s < Math.ceil(to); s += 1) {
      const weight = (Math.min(to, s + 1) - Math.max(from, s)) / scale;
      if (weight > 0 && s >= 0 && s < limit) taps.push([s, weight]);
    }
    rows.push(taps);
  }
  return rows;
};

const resample = ({ rgba, width, height }, { left, top, side }, size) => {
  // Premultiply once, so transparent pixels carry no colour into the average.
  const premul = new Float64Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const a = rgba[i * 4 + 3] / 255;
    premul[i * 4] = rgba[i * 4] * a;
    premul[i * 4 + 1] = rgba[i * 4 + 1] * a;
    premul[i * 4 + 2] = rgba[i * 4 + 2] * a;
    premul[i * 4 + 3] = a;
  }

  const xs = areaWeights(left, side, size, width);
  const ys = areaWeights(top, side, size, height);

  // Horizontal pass into a size x height buffer, then vertical.
  const across = new Float64Array(size * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const out = (y * size + x) * 4;
      for (const [s, w] of xs[x]) {
        const src = (y * width + s) * 4;
        for (let c = 0; c < 4; c += 1) across[out + c] += premul[src + c] * w;
      }
    }
  }

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0, 0];
      for (const [s, w] of ys[y]) {
        const src = (s * size + x) * 4;
        for (let c = 0; c < 4; c += 1) sum[c] += across[src + c] * w;
      }
      const out = (y * size + x) * 4;
      const a = sum[3];
      if (a <= 0) continue;
      pixels[out] = Math.round(Math.min(255, sum[0] / a));
      pixels[out + 1] = Math.round(Math.min(255, sum[1] / a));
      pixels[out + 2] = Math.round(Math.min(255, sum[2] / a));
      pixels[out + 3] = Math.round(Math.min(255, a * 255));
    }
  }
  return pixels;
};

/* ------------------------------------------------------------------ */
/* PNG and ICO encoding                                                */
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

/** An .ico holding one PNG per size (supported since Windows Vista). */
const encodeIco = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // no palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
};

/* ------------------------------------------------------------------ */

const source = decodeSource();
const square = logoSquare(source);

const write = (file, data, label) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`Wrote ${path.relative(ROOT, file)} (${label}, ${(data.length / 1024).toFixed(1)} KB)`);
};

for (const { file, size } of PNG_TARGETS) {
  write(file, encodePng(resample(source, square, size), size, size), `${size}x${size}`);
}

const icoImages = ICO_SIZES.map((size) => ({
  size,
  png: encodePng(resample(source, square, size), size, size),
}));
write(ICO_FILE, encodeIco(icoImages), ICO_SIZES.join('/'));

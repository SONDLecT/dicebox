// Generates the PWA icons: a d20 silhouette in line work, matching the app.
// Writes real PNGs with zlib-compressed scanlines — no image library needed.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolor + alpha
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A d20 seen face-on is a hexagon outline with an inscribed triangle and the
// three spokes joining them — the minimum line set that reads as an icosahedron.
function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = [0xFC, 0xFC, 0xFA];
  const fg = [0x1A, 0x1A, 0x18];

  for (let i = 0; i < size * size; i++) {
    buf[i*4] = bg[0]; buf[i*4+1] = bg[1]; buf[i*4+2] = bg[2]; buf[i*4+3] = 255;
  }

  const cx = size / 2, cy = size / 2;
  const r = size * (maskable ? 0.30 : 0.37);
  const lw = Math.max(2, size * 0.022);

  // A d20 face-on: hexagonal outline, an inner triangle rotated 60° against it,
  // and spokes joining the two. The rotation matters — align the triangle with
  // the hexagon's corners and the three spokes become radial, which is the
  // standard 2D drawing of a cube, not an icosahedron.
  const hex = [], tri = [], inner = r * 0.52;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    hex.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * (2 * Math.PI / 3);
    tri.push([cx + Math.cos(a) * inner, cy + Math.sin(a) * inner]);
  }

  const lines = [];
  for (let i = 0; i < 6; i++) lines.push([hex[i], hex[(i+1) % 6]]);
  for (let i = 0; i < 3; i++) lines.push([tri[i], tri[(i+1) % 3]]);
  // Each triangle corner reaches to the hexagon vertex two steps around, so the
  // spokes cross the field at an angle instead of pointing straight out.
  for (let i = 0; i < 3; i++) lines.push([tri[i], hex[(i * 2) % 6]]);

  const px = (x, y, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) buf[i+c] = Math.round(buf[i+c] * (1-a) + fg[c] * a);
  };

  // Supersampled distance-to-segment coverage gives clean antialiased strokes.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = Infinity;
      for (const [a, b] of lines) {
        const dx = b[0]-a[0], dy = b[1]-a[1];
        const L2 = dx*dx + dy*dy;
        let t = L2 ? ((x+0.5-a[0])*dx + (y+0.5-a[1])*dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x+0.5 - (a[0]+t*dx), y+0.5 - (a[1]+t*dy));
        if (d < best) best = d;
      }
      const cov = Math.max(0, Math.min(1, (lw/2 + 0.5) - best));
      if (cov > 0) px(x, y, cov);
    }
  }
  return png(size, size, buf);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), draw(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), draw(512, false));
fs.writeFileSync(path.join(out, 'icon-180.png'), draw(180, false));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), draw(512, true));
console.log('icons written');

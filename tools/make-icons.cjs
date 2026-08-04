// Generates rounded PWA tiles from the canonical deconstructed-d20 brand mark.
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

function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = [0xFC, 0xFC, 0xFA];
  const fg = [0x1A, 0x1A, 0x18];

  const cx = size / 2, cy = size / 2;
  const tileRadius = size * (104 / 512);

  // The ordinary icons are rounded tiles with transparent corners. A maskable
  // icon keeps the whole canvas because the launcher supplies its own crop.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x + 0.5 - cx) - (size / 2 - tileRadius);
      const dy = Math.abs(y + 0.5 - cy) - (size / 2 - tileRadius);
      const signed = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
        + Math.min(Math.max(dx, dy), 0) - tileRadius;
      const alpha = maskable ? 255 : Math.round(255 * Math.max(0, Math.min(1, 0.5 - signed)));
      const i = (y * size + x) * 4;
      buf[i] = bg[0]; buf[i+1] = bg[1]; buf[i+2] = bg[2]; buf[i+3] = alpha;
    }
  }

  // These are the visible segments of brand/d20.svg, expressed in its 24×24
  // coordinate system. Keeping the coordinates together makes visual drift
  // between the SVG action mark and generated PNG tiles obvious in review.
  const p = (x, y) => {
    const scale = size * (maskable ? 0.62 : 0.72) / 24;
    return [cx + (x - 12) * scale, cy + (y - 12) * scale];
  };
  const v = {
    top: p(12, 2.4), ur: p(20.3, 7), lr: p(20.3, 17),
    bottom: p(12, 21.6), ll: p(3.7, 17), ul: p(3.7, 7),
    faceR: p(16.4, 9.6), center: p(12, 12.2), faceL: p(7.6, 9.6),
  };
  const lines = [
    [v.top, v.ur], [v.ur, v.lr], [v.lr, v.bottom],
    [v.bottom, v.ll], [v.ll, v.ul], [v.ul, v.top],
    [v.top, v.faceR], [v.faceR, v.center], [v.center, v.faceL], [v.faceL, v.top],
    [v.center, v.bottom], [v.faceL, v.ul], [v.faceR, v.ur],
  ];
  const lw = Math.max(2, size * (1.5 / 24) * (maskable ? 0.62 : 0.72));

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

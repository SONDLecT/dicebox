// Renders each die shape to an SVG contact sheet so the wireframe look can be
// checked without a browser. Mirrors render.js's projection and edge sorting.

const fs = require('fs');
const path = require('path');

const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

function rotate(v, rx, ry, rz) {
  let [x, y, z] = v;
  let c = Math.cos(rx), s = Math.sin(rx);
  [y, z] = [y*c - z*s, y*s + z*c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x*c + z*s, -x*s + z*c];
  c = Math.cos(rz); s = Math.sin(rz);
  [x, y] = [x*c - y*s, x*s + y*c];
  return [x, y, z];
}

function faceNormal(pts) {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  const c = pts.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]);
  return dot(n, c) < 0 ? n.map(x => -x) : n;
}

(async () => {
  const { solidFor } = await import('../render.js');

  const SHOW = [4, 6, 8, 12, 20];
  const cell = 150, pad = 18, cols = SHOW.length;
  const W = cols * cell, H = cell + 46;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  out.push(`<rect width="${W}" height="${H}" fill="#FCFCFA"/>`);

  SHOW.forEach((sides, idx) => {
    const solid = solidFor(sides);
    const cx = idx * cell + cell / 2, cy = cell / 2 + 8;
    const s = (cell - pad * 2) / 2;

    // A slight tilt on all three axes shows depth better than a face-on view.
    const pts = solid.verts.map(v => rotate(v, 0.45, 0.62, 0.12));
    const proj = pts.map(p => {
      const d = 4 / (4 - p[2]);
      return [cx + p[0] * s * d, cy + p[1] * s * d];
    });

    const edges = new Map();
    for (const face of solid.faces) {
      const front = faceNormal(face.map(i => pts[i]))[2] > 0;
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i+1) % face.length];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) || false) || front);
      }
    }

    for (const pass of [false, true]) {
      const d = [];
      for (const [key, front] of edges) {
        if (front !== pass) continue;
        const [a, b] = key.split(':').map(Number);
        d.push(`M${proj[a][0].toFixed(2)},${proj[a][1].toFixed(2)}L${proj[b][0].toFixed(2)},${proj[b][1].toFixed(2)}`);
      }
      out.push(`<path d="${d.join('')}" stroke="#1A1A18" stroke-width="${pass ? 1.6 : 1.1}" ` +
               `stroke-opacity="${pass ? 1 : 0.22}" fill="none" stroke-linecap="round"/>`);
    }

    out.push(`<text x="${cx}" y="${cy + s + 26}" text-anchor="middle" ` +
             `font-family="monospace" font-size="13" fill="#9A968C">d${sides}</text>`);
  });

  out.push('</svg>');
  const file = path.join(__dirname, 'preview.svg');
  fs.writeFileSync(file, out.join('\n'));
  console.log('wrote', file);
})();

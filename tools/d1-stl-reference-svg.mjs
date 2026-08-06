// Deterministic multi-view reference SVG of the supplied Triple G D1 STL.
// The raw mesh is 196 unique vertices / 388 triangles / 582 edges, visually a
// capsule sliced by two oblique planes. This SVG renders it from several
// angles + orthographic projections, highlighting the two planar truncation
// faces, so it can be handed to an LLM or inspected directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outPath = path.resolve(arg('--out') || path.join(__dirname, 'd1-stl-reference.svg'));
const stlPath = arg('--stl') || '/home/dio/.hermes/cache/documents/doc_50c31adcfc83_d1.stl';
const buf = fs.readFileSync(stlPath);
const ntri = buf.readUInt32LE(0x50);

const tris = [];
let off = 84;
for (let i = 0; i < ntri; i++) {
  off += 12; // skip the 12-byte vertex normal
  const v = [];
  for (let k = 0; k < 3; k++) { v.push([buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)]); off += 12; }
  off += 2; // 2-byte attribute count
  tris.push({ v });
}

// Recover unique vertices and dedup triangle indices.
const verts = [], keyToId = new Map();
const vid = p => {
  const k = p.map(x => Math.round(x * 1e4)).join(':');
  if (keyToId.has(k)) return keyToId.get(k);
  const id = verts.length; verts.push(p); keyToId.set(k, id); return id;
};
const faces = tris.map(t => t.v.map(vid));

// Perspective projection assumes unit-ish coordinates, so normalize the mesh to
// max-norm 1 for display. (Measurements in the header keep the raw 41-unit scale.)
const maxNorm = Math.max(...verts.map(v => Math.hypot(v[0], v[1], v[2]))) || 1;
const vdisp = verts.map(v => v.map(x => x / maxNorm));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mag = v => Math.hypot(...v);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const faceNormal = t => {
  const n = cross(sub(t.v[1], t.v[0]), sub(t.v[2], t.v[0]));
  return mag(n) < 1e-9 ? [0, 0, 0] : n.map(x => x / mag(n));
};

// Classify truncation faces: triangles whose geometric normal lies near a global
// axis (the two oblique clip-plane cuts are axis-aligned in the STL frame).
const faceTone = [];
for (const t of tris) {
  const n = faceNormal(t);
  let tone = '#8A8F92'; // default neutral
  if (Math.abs(Math.abs(n[0]) - 1) < 0.05) tone = '#C66B32';   // x-normal truncation
  else if (Math.abs(Math.abs(n[2]) - 1) < 0.05) tone = '#397A86'; // z-normal truncation
  faceTone.push(tone);
}

function rotate(v, rx, ry, rz) {
  let [x, y, z] = v;
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

// Render one panel (either perspective or orthographic) of the wireframe.
// Returns the SVG inner markup (edges only), normalized to the supplied box.
function renderPanel(points2d, edges, box, title) {
  const xs = points2d.map(p => p[0]), ys = points2d.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const sx = (maxx - minx) || 1, sy = (maxy - miny) || 1;
  const scale = Math.min(box.w / sx, box.h / sy) * 0.9;
  const offx = box.x + (box.w - sx * scale) / 2 - minx * scale;
  const offy = box.y + (box.h - sy * scale) / 2 - miny * scale;
  const P = p => [offx + p[0] * scale, offy + p[1] * scale];
  const svg = [];
  // group edges by tone so strokes batch
  for (const tone of ['#C66B32', '#397A86', '#8A8F92']) {
    const d = [];
    for (const e of edges) {
      if (e.tone !== tone) continue;
      const a = P(points2d[e.a]), b = P(points2d[e.b]);
      d.push(`M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`);
    }
    if (d.length) svg.push(`<path d="${d.join('')}" stroke="${tone}" stroke-width="${tone === '#8A8F92' ? 1.1 : 2.4}" stroke-opacity="${tone === '#8A8F92' ? 0.34 : 0.9}" fill="none" stroke-linejoin="round"/>`);
  }
  svg.push(`<text x="${box.x + box.w / 2}" y="${box.y + box.h + 18}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#444">${title}</text>`);
  return svg.join('\n');
}

// Build edge list from faces, tagged by whether either adjacent face is a
// truncation plane.
const edgeMap = new Map();
faces.forEach((face, fi) => {
  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { a, b, tone: '#8A8F92' });
    if (faceTone[fi] !== '#8A8F92') edgeMap.get(key).tone = faceTone[fi];
  }
});
const edges = [...edgeMap.values()];

const W = 1400;
const panels = [
  { title: 'perspective 1', kind: 'persp', angles: [0.5, 0.7, 0.15], box: { x: 40, y: 70, w: 400, h: 340 } },
  { title: 'perspective 2', kind: 'persp', angles: [-0.7, 0.35, -0.2], box: { x: 500, y: 70, w: 400, h: 340 } },
  { title: 'perspective 3', kind: 'persp', angles: [0.2, -0.9, 0.4], box: { x: 960, y: 70, w: 400, h: 340 } },
  { title: 'orthographic — looking along X (y,z)', kind: 'ortho', axis: 0, box: { x: 40, y: 470, w: 400, h: 340 } },
  { title: 'orthographic — looking along Y (x,z) · circular section', kind: 'ortho', axis: 1, box: { x: 500, y: 470, w: 400, h: 340 } },
  { title: 'orthographic — looking along Z (x,y)', kind: 'ortho', axis: 2, box: { x: 960, y: 470, w: 400, h: 340 } },
];
const H = 830;

let out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<rect width="${W}" height="${H}" fill="#F5F1E8"/>`);
out.push(`<style>text{font-family:sans-serif}.title{font-weight:700;fill:#1D211E}.muted{fill:#6E7068}.mono{font-family:monospace}</style>`);
out.push(`<text x="40" y="34" class="title" font-size="26">Triple G Workshop D1 — raw STL reference (196 verts · 388 tris)</text>`);
out.push(`<text x="40" y="58" class="muted" font-size="14">BBox 41.1(x) × 14.2(y) × 41.1(z) · convex · near-circular cross-section · two oblique planar truncations (orange = x-cut, teal = z-cut)</text>`);

for (const p of panels) {
  if (p.kind === 'persp') {
    const R = vdisp.map(v => rotate(v, ...p.angles));
    const pts2d = R.map(q => { const d = 4 / (4 - q[2]); return [q[0] * d, q[1] * d]; });
    const es = edges.map(e => ({ ...e, a: e.a, b: e.b }));
    out.push(renderPanel(pts2d, es, p.box, p.title));
  } else {
    const dims = [0, 1, 2].filter(i => i !== p.axis);
    const pts2d = vdisp.map(v => [v[dims[0]], v[dims[1]]]);
    out.push(renderPanel(pts2d, edges, p.box, p.title));
  }
}

out.push(`<text x="40" y="${H - 18}" class="muted mono" font-size="12">orange = the two a-axis-aligned truncation cut faces · teal = other planar region · grey = rounded capsule/oblique surface</text>`);
out.push('</svg>');
fs.writeFileSync(outPath, out.join('\n'));
console.log(`wrote ${outPath}`);

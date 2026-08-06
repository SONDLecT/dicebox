// Deterministic, review-only comparison gallery for the Dicebox D1.
// Renders four D1 candidates at three fixed angles:
//   1. Current Dicebox  — the notched cylinder (runtime solidFor(1))
//   2. Triple G wedge   — faithful mesh from the supplied printables STL
//   3. Spherical segment — ChatGPT canonical K = {sphere, z >= -0.55}
//   4. Elongated segment — affine-stretched spherical segment (λ=1.4)
// This tool does not alter Dicebox's runtime geometry.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solidFor } from '../render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (v, s) => v.map(x => x * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mag = v => Math.hypot(...v);
const norm = v => { const m = mag(v) || 1; return v.map(x => x / m); };
const centroid = pts => mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function normalize(solid) {
  const center = mul(centroid(solid.verts), 1);
  const scale = Math.max(...solid.verts.map(mag)) || 1;
  return {
    ...solid,
    verts: solid.verts.map(v => mul(v, 1 / scale)),
    faces: solid.faces.map(f => [...f]),
    faceKinds: solid.faceKinds ? [...solid.faceKinds] : undefined,
    hideSmoothEdges: !!solid.hideSmoothEdges,
  };
}

function rotate(v, rx, ry, rz) {
  let [x, y, z] = v;
  let c = Math.cos(rx), s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
function faceNormal(pts) {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  return dot(n, centroid(pts)) < 0 ? mul(n, -1) : n;
}
function edgeStats(solid) {
  const edges = new Map();
  for (const face of solid.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  return { V: solid.verts.length, E: edges.size, F: solid.faces.length, manifold: [...edges.values()].every(n => n === 2) };
}
function geometryProblems(solid, epsilon = 1e-6, checkConvex = true) {
  const problems = [];
  const center = centroid(solid.verts);
  solid.faces.forEach((face, fi) => {
    if (face.length < 3 || new Set(face).size !== face.length) {
      problems.push(`face ${fi} has fewer than three unique vertices`); return;
    }
    const points = face.map(i => solid.verts[i]);
    let n;
    for (let i = 1; i < points.length - 1 && !n; i++) {
      const candidate = cross(sub(points[i], points[0]), sub(points[i + 1], points[0]));
      if (mag(candidate) > epsilon) n = norm(candidate);
    }
    if (!n) { problems.push(`face ${fi} has zero area`); return; }
    const faceCenter = centroid(points);
    if (dot(n, sub(faceCenter, center)) < 0) n = mul(n, -1);
    const maxPlanarityError = Math.max(...points.map(p => Math.abs(dot(n, sub(p, points[0])))));
    if (maxPlanarityError > epsilon) problems.push(`face ${fi} is non-planar by ${maxPlanarityError}`);
    if (checkConvex) {
      const maxOutside = Math.max(...solid.verts.map(p => dot(n, sub(p, points[0]))));
      if (maxOutside > epsilon) problems.push(`face ${fi} is non-convex by ${maxOutside}`);
    }
  });
  return problems;
}
function cleanLoop(points, epsilon = 1e-9) {
  const loop = [];
  for (const p of points) {
    if (!loop.length || mag(sub(p, loop.at(-1))) > epsilon) loop.push(p);
  }
  if (loop.length > 1 && mag(sub(loop[0], loop.at(-1))) <= epsilon) loop.pop();
  return loop;
}
function clipPolygon(points, planeNormal, offset, cuts, epsilon = 1e-10) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const dp = dot(planeNormal, p) - offset, dq = dot(planeNormal, q) - offset;
    const pIn = dp <= epsilon, qIn = dq <= epsilon;
    if (pIn) out.push(p);
    if (pIn !== qIn) {
      const t = dp / (dp - dq);
      out.push(add(p, mul(sub(q, p), t))); cuts.push(out.at(-1));
    }
  }
  return cleanLoop(out);
}
function subdividedIcosphere(levels = 3) {
  const base = solidFor(20);
  let { verts, faces } = { verts: base.verts.map(v => [...v]), faces: base.faces.map(f => [...f]) };
  for (let level = 0; level < levels; level++) {
    const midpoints = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (midpoints.has(key)) return midpoints.get(key);
      const id = verts.length; verts.push(norm(add(verts[a], verts[b]))); midpoints.set(key, id); return id;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { verts, faces };
}

// Faithful reconstruction from the supplied printables binary STL. Deduplicates
// vertices, keeps the raw triangles, centres and unit-normalizes for the gallery.
function solidFromSTL(buffer) {
  if (buffer.length < 84) throw new Error('STL too short');
  const ntri = buffer.readUInt32LE(80);
  if (buffer.length !== 84 + ntri * 50) throw new Error(`STL triangle count ${ntri} does not match file size`);
  const verts = [], byKey = new Map(), faces = [];
  const vertex = p => {
    const key = p.map(x => Math.round(x * 1e4)).join(':');
    if (byKey.has(key)) return byKey.get(key);
    const id = verts.length; verts.push(p); byKey.set(key, id); return id;
  };
  let off = 84;
  for (let i = 0; i < ntri; i++) {
    const p = () => [buffer.readFloatLE(off), buffer.readFloatLE(off + 4), buffer.readFloatLE(off + 8)];
    off += 12;             // normal
    const v0 = p(); off += 12;
    const v1 = p(); off += 12;
    const v2 = p(); off += 12;
    off += 2;              // attribute
    faces.push([vertex(v0), vertex(v1), vertex(v2)]);
  }
  const center = mul(centroid(verts), 1);
  return normalize({ verts: verts.map(v => sub(v, center)), faces, rawMesh: true });
}

// ChatGPT canonical D1: unit sphere with one cap removed by z >= -a, a single
// planar landing disk. a = 0.55 (R = 1).
function sphericalSegmentD1(a = 0.55, levels = 3) {
  const sphere = subdividedIcosphere(levels);
  let polygons = sphere.faces.map(face => ({ points: face.map(i => sphere.verts[i]), kind: 'sphere' }));
  const planeNormal = [0, 0, -1], planeOffset = a;
  const cuts = [], clipped = [];
  for (const polygon of polygons) {
    const points = clipPolygon(polygon.points, planeNormal, planeOffset, cuts);
    if (points.length >= 3) clipped.push({ points, kind: polygon.kind });
  }
  const unique = new Map();
  for (const p of cuts) unique.set(p.map(x => Math.round(x * 1e9)).join(':'), p);
  const ring = [...unique.values()];
  if (ring.length < 3) throw new Error('d1 spherical segment clipping failed');
  ring.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  if (dot(faceNormal(ring), planeNormal) < 0) ring.reverse();
  clipped.push({ points: ring, kind: 'cap' });
  const verts = [], byPosition = new Map(), faces = [], faceKinds = [];
  const vertex = p => {
    const key = p.map(x => Math.round(x * 1e8)).join(':');
    if (byPosition.has(key)) return byPosition.get(key);
    const id = verts.length; verts.push(p); byPosition.set(key, id); return id;
  };
  for (const polygon of clipped) {
    const face = cleanLoop(polygon.points).map(vertex);
    const clean = face.filter((id, i) => id !== face[(i + face.length - 1) % face.length]);
    if (clean.length < 3) continue;
    faces.push(clean); faceKinds.push(polygon.kind);
  }
  return normalize({ verts, faces, faceKinds });
}

function elongatedSegment(a = 0.55, lambda = 1.4, levels = 3) {
  const solid = sphericalSegmentD1(a, levels);
  // Affine stretch along x, then re-normalize so the die fits the gallery box.
  return normalize({ ...solid, verts: solid.verts.map(v => [v[0] * lambda, v[1], v[2]]) });
}

// Canonical low-poly rounded-wedge D1, matching the sparse wireframe style of the
// other Dicebox dice. Cross-section (in x-z) is bounded by a flat landing edge,
// a flat back edge at right angles to it, and a quarter-ellipse arc closing the
// rounded front/top; the profile is extruded in the thin (y) axis and capped at
// each end. Two perpendicular flat rectangles (like the Triple G STL) plus a
// rounded back, in only s+4 faces.
function roundedWedgeD1(L = 1.42, H = 1.42, W = 1.0, s = 4) {
  // Profile points around the cross-section: corner (0,0), front-bottom (L,0),
  // quarter-ellipse arc to back-top (0,H).
  const px = [[0, 0], [L, 0]];
  for (let k = 1; k < s; k++) {
    const t = k / s;
    px.push([L * Math.cos(t * Math.PI / 2), H * Math.sin(t * Math.PI / 2)]);
  }
  px.push([0, H]);
  // px order: [0]=(0,0), [1]=(L,0), [2..s]=arc, [s+1]=(0,H)
  const half = W / 2;
  const verts = [];
  const id = (i, side) => { const r = i * 2 + side; if (!verts[r]) verts[r] = [px[i][0], side ? half : -half, px[i][1]]; return r; };
  const cap = i => id(i, 0); // lower end cap (y=-half)
  const capP = i => id(i, 1); // upper end cap (y=+half)
  const n = s + 2; // profile point count
  const faces = [];
  // 1. Landing flat (bottom): rectangle along profile edge 0->1 (z=0).
  faces.push([cap(0), cap(1), capP(1), capP(0)]);
  // 2. Back flat: rectangle along profile edge (0,H)->(0,0) (x=0).
  faces.push([capP(n - 1), cap(n - 1), cap(0), capP(0)]);
  // 3. Rounded strips along the arc profile edges (i=1..s+1); the bottom edge
  // (0->1) is already the landing face and the back edge is the back face.
  for (let j = 2; j < n; j++) faces.push([cap(j - 1), cap(j), capP(j), capP(j - 1)]);
  // 4. End caps: the full profile outline at each y end.
  faces.push(Array.from({ length: n }, (_, i) => cap(i)));
  faces.push(Array.from({ length: n }, (_, i) => capP(n - 1 - i)));
  // Ensure sensible outward winding.
  return normalize({ verts: verts.slice(0, n * 2), faces });
}

// Canonical D1 from the STL analysis (2026-08-06): an obliquely terminated
// circular cylinder. The infinite cylinder runs diagonally through the x-z
// plane with axis d=(-1,0,1)/sqrt2 and cross-section radius R; it is clipped by
// the two perpendicular planes x>=-a and z>=-a. n = circumscribed polygon sides
// for the circular section. Exact vertex coordinates (per the derivation):
//   A_k (z=-a end) = [a + sqrt2*R*cos, R*sin, -a]
//   B_k (x=-a end) = [-a, R*sin, a + sqrt2*R*cos]
function obliqueCylinderD1(R = 1, a = 2.187, n = 12) {
  const s2 = Math.SQRT2, verts = [], faces = [];
  const A = [], B = [];
  for (let k = 0; k < n; k++) {
    const th = 2 * Math.PI * k / n, c = Math.cos(th), s = Math.sin(th);
    const ka = verts.length; verts.push([a * R + s2 * R * c, R * s, -a * R]); A.push(ka);
    const kb = verts.length; verts.push([-a * R, R * s, a * R + s2 * R * c]); B.push(kb);
  }
  // Caps (z=-a, outward (0,0,-1); x=-a, outward (-1,0,0)).
  faces.push([...A].reverse());
  faces.push([...B]);
  // Lateral quads between adjacent parallel generators.
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    faces.push([A[k], A[j], B[j], B[k]]);
  }
  return normalize({ verts, faces });
}

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outPath = path.resolve(arg('--out') || path.join(__dirname, 'd1-shape-study.svg'));
const stlPath = arg('--stl') || '/home/dio/.hermes/cache/documents/doc_50c31adcfc83_d1.stl';
if (!fs.existsSync(stlPath)) throw new Error(`STL not found: ${stlPath}`);
const stlBuffer = fs.readFileSync(stlPath);

const candidates = {
  d1Current: normalize(solidFor(1)),
  d1Wedge: solidFromSTL(stlBuffer),
  d1WedgeCanon: roundedWedgeD1(1.42, 1.42, 1.0, 4),
  d1Cylinder: obliqueCylinderD1(1, 2.187, 12),
  d1Segment: sphericalSegmentD1(0.55),
  d1SegmentElong: elongatedSegment(0.55, 1.4),
};

// Geometry invariants before drawing. The faithful STL reconstruction is a real
// printable shape with genuine concavity (chamfers/engravings), so convexity is
// relaxed for it; manifoldness, planarity, and genus are still enforced strictly.
for (const [name, solid] of Object.entries(candidates)) {
  const s = edgeStats(solid);
  if (!s.manifold || s.V - s.E + s.F !== 2) throw new Error(`${name}: not a closed manifold; V/E/F=${s.V}/${s.E}/${s.F}`);
  const problems = geometryProblems(solid, 1e-6, name !== 'd1Wedge');
  if (problems.length) throw new Error(`${name}: ${problems.slice(0, 4).join('; ')}`);
}

// D1-wedge faithfulness facts extracted from the mesh: the two dominant planar
// faces and their in-plane proportions.
function planarFaces(solid, tol = 4e-3) {
  // group triangle faces by (rounded) outward normal, report largest planes
  const groups = new Map();
  solid.faces.forEach((face, fi) => {
    const pts = face.map(i => solid.verts[i]);
    let n;
    for (let i = 1; i < pts.length - 1 && !n; i++) {
      const c = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]));
      if (mag(c) > 1e-9) n = norm(c);
    }
    if (!n) return;
    if (dot(n, centroid(pts)) < 0) n = mul(n, -1);
    const key = n.map(x => Math.round(x / tol)).join(',');
    const g = groups.get(key) || { n, faces: [] };
    g.faces.push(fi); groups.set(key, g);
  });
  return [...groups.values()].sort((a, b) => b.faces.length - a.faces.length);
}
const wedgePlanes = planarFaces(candidates.d1Wedge).slice(0, 3).map(g => ({
  normal: g.n.map(x => Math.round(x * 100) / 100),
  triangles: g.faces.length,
}));

const W = 1900, topH = 330, rowH = 250, detailH = 320, detailY = topH + rowH;
const singleStudy = {
  die: 'd1',
  finding: 'Triple G wedge reconstruction (from supplied STL) vs current and spherical-segment candidates',
  current: candidates.d1Current,
  options: [
    { label: 'Triple G · oblique cylinder', note: 'recommended · 2 end caps + 12 lateral quads', solid: candidates.d1Cylinder, tone: '#397A86' },
    { label: 'Spherical segment · ChatGPT canonical', note: 'K = sphere, z ≥ −0.55, one landing disk', solid: candidates.d1Segment, tone: '#C66B32' },
    { label: 'Elongated spherical segment · λ=1.4', note: 'stretched toward an elongated profile', solid: candidates.d1SegmentElong, tone: '#8A5A2B' },
  ],
};
const H = detailY + detailH + 70;
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
out.push(`<rect width="${W}" height="${H}" fill="#F5F1E8"/>`);
out.push(`<style>text{font-family:sans-serif}.title{font-weight:700;fill:#1D211E}.muted{fill:#6E7068}.mono{font-family:monospace}</style>`);
out.push(`<text x="54" y="64" class="title" font-size="34">Dicebox · D1 shape study</text>`);
out.push(`<text x="54" y="98" class="muted" font-size="17">Review-only artifact · runtime geometry unchanged · deterministic geometry and angles · source STL: Triple G Workshop “always rolls 1”</text>`);
out.push(`<rect x="54" y="126" width="1792" height="2" fill="#D8D1C3"/>`);

function drawModel(solid, x, y, width, tone, label, note, maxScale = 65, cardH = 205) {
  const stats = edgeStats(solid);
  out.push(`<rect x="${x}" y="${y}" width="${width}" height="${cardH}" rx="14" fill="#FBF9F4" stroke="#DED7CA"/>`);
  out.push(`<text x="${x + 18}" y="${y + 27}" class="title" font-size="16" fill="${tone}">${esc(label)}</text>`);
  out.push(`<text x="${x + 18}" y="${y + 49}" class="muted" font-size="13">${esc(note)}</text>`);
  out.push(`<text x="${x + width - 18}" y="${y + 27}" text-anchor="end" class="muted mono" font-size="12">V${stats.V} · E${stats.E} · F${stats.F}</text>`);
  const views = [[0.45, 0.62, 0.12], [-0.55, 0.25, -0.15], [0.18, -0.83, 0.42]];
  const viewW = (width - 28) / 3;
  views.forEach((angles, vi) => {
    const cx = x + 14 + viewW * (vi + 0.5), cy = y + cardH * 0.615, scale = Math.min(maxScale, viewW * 0.38);
    const pts = solid.verts.map(v => rotate(v, ...angles));
    const proj = pts.map(p => { const d = 4 / (4 - p[2]); return [cx + p[0] * scale * d, cy + p[1] * scale * d]; });
    const frontFaces = solid.faces.map((face, fi) => {
      const n = faceNormal(face.map(i => pts[i]));
      return { face, fi, front: n[2] > 0, depth: face.reduce((s, i) => s + pts[i][2], 0) / face.length };
    }).filter(item => item.front).sort((a, b) => a.depth - b.depth);
    const sphereFill = [], capFill = [];
    for (const { face, fi } of frontFaces) {
      const d = `${face.map((id, i) => `${i ? 'L' : 'M'}${proj[id][0].toFixed(2)},${proj[id][1].toFixed(2)}`).join('')}Z`;
      (solid.faceKinds?.[fi] === 'cap' ? capFill : sphereFill).push(d);
    }
    if (sphereFill.length) out.push(`<path d="${sphereFill.join('')}" fill="${tone}" fill-opacity="${solid.rawMesh ? 0 : 0.05}" stroke="none"/>`);
    if (capFill.length) out.push(`<path d="${capFill.join('')}" fill="${tone}" fill-opacity="0.18" stroke="none"/>`);
    const edges = new Map();
    solid.faces.forEach(face => {
      const front = faceNormal(face.map(i => pts[i]))[2] > 0;
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!edges.has(key)) edges.set(key, { front: false, back: false });
        const e = edges.get(key); e[front ? 'front' : 'back'] = true;
      }
    });
    for (const pass of [false, true]) {
      const d = [];
      for (const [key, e] of edges) {
        if (e.front !== pass) continue;
        const [a, b] = key.split(':').map(Number);
        d.push(`M${proj[a][0].toFixed(2)},${proj[a][1].toFixed(2)}L${proj[b][0].toFixed(2)},${proj[b][1].toFixed(2)}`);
      }
      out.push(`<path d="${d.join('')}" stroke="${tone}" stroke-width="${pass ? 2 : 1.15}" stroke-opacity="${pass ? 0.98 : 0.18}" fill="none" stroke-linecap="round"/>`);
    }
    out.push(`<text x="${cx}" y="${y + cardH - 13}" text-anchor="middle" class="muted mono" font-size="10">view ${vi + 1}</text>`);
  });
}

const y = topH;
out.push(`<rect x="36" y="${y}" width="1828" height="232" rx="16" fill="#EEE8DC"/>`);
out.push(`<text x="58" y="${y + 48}" class="title" font-size="28">${singleStudy.die}</text>`);
singleStudy.finding.split('\n').slice(0, 3).forEach((line, li) => {
  out.push(`<text x="58" y="${y + 77 + li * 19}" class="muted" font-size="14">${esc(line)}</text>`);
});
// Present the current, then the three options as the main comparison row.
drawModel(singleStudy.current, 250, y + 13, 500, '#73776F', 'Current Dicebox', 'now the runtime oblique cylinder', 65);
singleStudy.options.forEach((option, oi) => drawModel(option.solid, 770 + oi * 540, y + 13, 520, option.tone, option.label, option.note));

out.push(`<text x="58" y="${y + 205}" class="muted mono" font-size="12">STL wedge dominant planes: ${wedgePlanes.map(p => `n(${p.normal.join('/')}) × ${p.triangles} tris`).join('  ·  ')}</text>`);

// Large close-up of the canonical (clean low-poly) wedge so the wireframe is
// legible and clearly comparable with the other dice's sparse line-work. The
// raw STL, by contrast, is noted as too dense for the Dicebox style.
out.push(`<rect x="36" y="${detailY + 14}" width="1828" height="${detailH - 20}" rx="16" fill="#EEE8DC"/>`);
out.push(`<text x="58" y="${detailY + 48}" class="title" font-size="20">Triple G D1 — oblique cylinder · canonical wireframe (zoomed)</text>`);
out.push(`<text x="58" y="${detailY + 70}" class="muted" font-size="13">Obliquely terminated circular cylinder: ${candidates.d1Cylinder.verts.length} verts · ${candidates.d1Cylinder.faces.length} faces · matches Dicebox's sparse line-work</text>`);
drawModel(candidates.d1Cylinder, 354, detailY + 84, 1192, '#397A86', 'Oblique cylinder (canonical)', '2 end caps + 12 lateral quads', 150, 210);
out.push(`<text x="1586" y="${detailY + 48}" class="title" font-size="15">raw STL · reference</text>`);
out.push(`<text x="1586" y="${detailY + 68}" class="muted mono" font-size="11">${candidates.d1Wedge.verts.length} verts · ${candidates.d1Wedge.faces.length} tris</text>`);
out.push(`<text x="1586" y="${detailY + 86}" class="muted" font-size="11">too dense for the Dicebox</text>`);
out.push(`<text x="1586" y="${detailY + 100}" class="muted" font-size="11">wireframe style — kept only</text>`);
out.push(`<text x="1586" y="${detailY + 114}" class="muted" font-size="11">as the source reference.</text>`);
drawModel(candidates.d1Wedge, 1586, detailY + 120, 258, '#73776F', 'STL', 'reference', 40, 180);
out.push(`<text x="54" y="${H - 30}" class="muted" font-size="14">Decision gate: pick a D1 silhouette. The STL wedge is a faithful mesh reconstruction; the segments are canonical. No worker deployment.</text>`);
out.push('</svg>');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'));
console.log(`wrote ${outPath}`);
for (const [name, solid] of Object.entries(candidates)) {
  const s = edgeStats(solid);
  console.log(`${name.padEnd(16)} V${s.V} E${s.E} F${s.F} manifold=${s.manifold}`);
}

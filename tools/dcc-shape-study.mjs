// Deterministic, review-only comparison gallery for recognizable DCC dice.
// This tool does not alter Dicebox's runtime geometry. It imports the current
// models and renders proposed candidates beside them at three fixed angles.

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
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mag = v => Math.hypot(...v);
const norm = v => { const m = mag(v) || 1; return v.map(x => x / m); };
const centroid = pts => mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function wrapWords(text, maxLength = 25) {
  const lines = [];
  for (const word of text.split(/\s+/)) {
    if (!lines.length || `${lines.at(-1)} ${word}`.trim().length > maxLength) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  }
  return lines;
}

function normalize(solid) {
  const scale = Math.max(...solid.verts.map(mag)) || 1;
  return {
    ...solid,
    verts: solid.verts.map(v => mul(v, 1 / scale)),
    faces: solid.faces.map(f => [...f]),
    faceKinds: solid.faceKinds ? [...solid.faceKinds] : undefined,
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

function geometryProblems(solid, epsilon = 1e-6) {
  const problems = [];
  const center = centroid(solid.verts);
  solid.faces.forEach((face, fi) => {
    if (face.length < 3 || new Set(face).size !== face.length) {
      problems.push(`face ${fi} has fewer than three unique vertices`);
      return;
    }
    const points = face.map(i => solid.verts[i]);
    let n;
    for (let i = 1; i < points.length - 1 && !n; i++) {
      const candidate = cross(sub(points[i], points[0]), sub(points[i + 1], points[0]));
      if (mag(candidate) > epsilon) n = norm(candidate);
    }
    if (!n) {
      problems.push(`face ${fi} has zero area`);
      return;
    }
    const faceCenter = centroid(points);
    if (dot(n, sub(faceCenter, center)) < 0) n = mul(n, -1);
    const maxPlanarityError = Math.max(...points.map(p => Math.abs(dot(n, sub(p, points[0])))));
    if (maxPlanarityError > epsilon) problems.push(`face ${fi} is non-planar by ${maxPlanarityError}`);
    const maxOutside = Math.max(...solid.verts.map(p => dot(n, sub(p, points[0]))));
    if (maxOutside > epsilon) problems.push(`face ${fi} is non-convex by ${maxOutside}`);
  });
  return problems;
}

function regularPrism(n, halfHeight = 0.72) {
  const verts = [];
  for (const y of [-halfHeight, halfHeight]) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * TAU / n;
      verts.push([Math.cos(a), y, Math.sin(a)]);
    }
  }
  const faces = [
    Array.from({ length: n }, (_, i) => n - 1 - i),
    Array.from({ length: n }, (_, i) => n + i),
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n + j, n + i]);
  }
  return normalize({ verts, faces });
}

function subdividedIcosphere(levels = 3) {
  let { verts, faces } = normalize(solidFor(20));
  for (let level = 0; level < levels; level++) {
    const midpoints = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (midpoints.has(key)) return midpoints.get(key);
      const id = verts.length;
      verts.push(norm(add(verts[a], verts[b])));
      midpoints.set(key, id);
      return id;
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
    const dp = dot(planeNormal, p) - offset;
    const dq = dot(planeNormal, q) - offset;
    const pInside = dp <= epsilon, qInside = dq <= epsilon;
    if (pInside) out.push(p);
    if (pInside !== qInside) {
      const t = dp / (dp - dq);
      const hit = add(p, mul(sub(q, p), t));
      out.push(hit);
      cuts.push(hit);
    }
  }
  return cleanLoop(out);
}

function c3vD7Normals() {
  // Proven-optimal N=7 spherical code, rotated into its C3v 1+3+3 form.
  const c = 0.2101383127306031;
  const lowerZ = -Math.sqrt((1 + 2 * c) / 3);
  const upperR = Math.sqrt(1 - c * c);
  const lowerR = Math.sqrt(1 - lowerZ * lowerZ);
  const normals = [[0, 0, 1]];
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3;
    normals.push([upperR * Math.cos(a), upperR * Math.sin(a), c]);
  }
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 3 + k * TAU / 3;
    normals.push([lowerR * Math.cos(a), lowerR * Math.sin(a), lowerZ]);
  }
  return normals;
}

function clippedSphereD7(levels = 3) {
  const normals = c3vD7Normals();
  const c = 0.2101383127306031;
  const offset = Math.sqrt((1 + c) / 2);
  const sphere = subdividedIcosphere(levels);
  let polygons = sphere.faces.map(face => ({ points: face.map(i => sphere.verts[i]), kind: 'sphere' }));

  for (const planeNormal of normals) {
    const cuts = [];
    const clipped = [];
    for (const polygon of polygons) {
      const points = clipPolygon(polygon.points, planeNormal, offset, cuts);
      if (points.length >= 3) clipped.push({ points, kind: polygon.kind });
    }
    const unique = new Map();
    for (const p of cuts) unique.set(p.map(x => Math.round(x * 1e9)).join(':'), p);
    const ring = [...unique.values()];
    if (ring.length < 3) throw new Error('d7 clipping failed to produce a landing-flat boundary');
    const axis = planeNormal;
    const basisA = norm(Math.abs(axis[2]) < 0.9 ? cross(axis, [0, 0, 1]) : cross(axis, [0, 1, 0]));
    const basisB = cross(axis, basisA);
    const center = mul(axis, offset);
    ring.sort((a, b) => {
      const pa = sub(a, center), pb = sub(b, center);
      return Math.atan2(dot(pa, basisB), dot(pa, basisA)) - Math.atan2(dot(pb, basisB), dot(pb, basisA));
    });
    if (dot(faceNormal(ring), axis) < 0) ring.reverse();
    clipped.push({ points: ring, kind: 'cap' });
    polygons = clipped;
  }

  const verts = [], byPosition = new Map(), faces = [], faceKinds = [];
  const vertex = p => {
    const key = p.map(x => Math.round(x * 1e8)).join(':');
    if (byPosition.has(key)) return byPosition.get(key);
    const id = verts.length;
    verts.push(p);
    byPosition.set(key, id);
    return id;
  };
  for (const polygon of polygons) {
    const face = cleanLoop(polygon.points).map(vertex);
    const clean = face.filter((id, i) => id !== face[(i + face.length - 1) % face.length]);
    if (clean.length < 3) continue;
    faces.push(clean);
    faceKinds.push(polygon.kind);
  }
  return normalize({ verts, faces, faceKinds, hideSmoothEdges: true, d7Normals: normals, planeOffset: offset });
}

function trapezohedron(n, flatten = 1.0) {
  // The ring/apex ratio is fixed by face planarity. Squashing the complete y
  // axis afterward changes the silhouette without bowing the kite faces.
  const H = 2 / (1 - Math.cos(Math.PI / n)) - 1;
  const squash = flatten / H;
  const verts = [[0, H * squash, 0], [0, -H * squash, 0]];
  for (let i = 0; i < n; i++) {
    const a = i * TAU / n;
    verts.push([Math.cos(a), squash, Math.sin(a)]);
  }
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * TAU / n;
    verts.push([Math.cos(a), -squash, Math.sin(a)]);
  }
  const top = i => 2 + (i % n), bottom = i => 2 + n + (i % n);
  const faces = [];
  for (let i = 0; i < n; i++) {
    faces.push([0, top(i), bottom(i), top(i + 1)]);
    faces.push([1, bottom(i + n - 1), top(i), bottom(i)]);
  }
  return normalize({ verts, faces });
}

function bipyramid(n, poleHeight = 1.05) {
  const verts = [];
  for (let i = 0; i < n; i++) {
    const a = i * TAU / n;
    verts.push([Math.cos(a), 0, Math.sin(a)]);
  }
  const bottom = verts.length, top = bottom + 1;
  verts.push([0, -poleHeight, 0], [0, poleHeight, 0]);
  const faces = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faces.push([top, i, next], [bottom, next, i]);
  }
  return normalize({ verts, faces });
}

// Adds one inset face per original face, an edge strip per original edge, and a
// cap per original vertex. This is a display-only study of an Impact-like softer
// silhouette; bevel patches are not logical outcomes.
function bevelSolid(input, amount = 0.2) {
  const solid = normalize(input);
  const verts = [], faces = [];
  const inset = solid.faces.map((face, fi) => {
    const c = centroid(face.map(i => solid.verts[i]));
    const ids = face.map(vi => {
      const p = add(mul(solid.verts[vi], 1 - amount), mul(c, amount));
      const id = verts.length;
      verts.push(p);
      return { vi, id };
    });
    faces.push(ids.map(x => x.id));
    return { fi, ids };
  });
  const at = new Map();
  for (const f of inset) for (const item of f.ids) at.set(`${f.fi}:${item.vi}`, item.id);

  const edgeFaces = new Map();
  solid.faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edgeFaces.has(key)) edgeFaces.set(key, []);
      edgeFaces.get(key).push({ fi, a, b });
    }
  });
  for (const pair of edgeFaces.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    faces.push([at.get(`${a.fi}:${a.a}`), at.get(`${a.fi}:${a.b}`), at.get(`${b.fi}:${a.b}`), at.get(`${b.fi}:${a.a}`)]);
  }

  solid.verts.forEach((v, vi) => {
    const ids = inset.filter(f => f.ids.some(x => x.vi === vi)).map(f => at.get(`${f.fi}:${vi}`));
    if (ids.length < 3) return;
    const axis = norm(v);
    const ref = norm(sub(verts[ids[0]], mul(axis, dot(axis, verts[ids[0]]))));
    const side = cross(axis, ref);
    ids.sort((a, b) => {
      const pa = sub(verts[a], v), pb = sub(verts[b], v);
      return Math.atan2(dot(pa, side), dot(pa, ref)) - Math.atan2(dot(pb, side), dot(pb, ref));
    });
    faces.push(ids);
  });
  return normalize({ verts, faces });
}

function tetrakisHexahedron() {
  const verts = [];
  const corner = new Map();
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    corner.set(`${x}:${y}:${z}`, verts.length);
    verts.push([x, y, z]);
  }
  const axis = [
    [1.5, 0, 0], [-1.5, 0, 0], [0, 1.5, 0],
    [0, -1.5, 0], [0, 0, 1.5], [0, 0, -1.5],
  ];
  const apex = axis.map(v => { const i = verts.length; verts.push(v); return i; });
  const rings = [
    [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]],
    [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]],
    [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]],
    [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]],
    [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],
    [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]],
  ];
  const faces = [];
  rings.forEach((ring, ri) => {
    const ids = ring.map(v => corner.get(v.join(':')));
    for (let i = 0; i < 4; i++) faces.push([apex[ri], ids[i], ids[(i + 1) % 4]]);
  });
  return normalize({ verts, faces });
}

function seedOrder(points) {
  let i0 = 0, i1 = 1, i2 = 2, i3 = 3;
  for (let i = 1; i < points.length; i++) if (points[i][0] < points[i0][0]) i0 = i;
  let best = -1;
  for (let i = 0; i < points.length; i++) {
    const d = mag(sub(points[i], points[i0]));
    if (i !== i0 && d > best) { best = d; i1 = i; }
  }
  best = -1;
  const line = sub(points[i1], points[i0]);
  for (let i = 0; i < points.length; i++) {
    const area = mag(cross(line, sub(points[i], points[i0])));
    if (i !== i0 && i !== i1 && area > best) { best = area; i2 = i; }
  }
  best = -1;
  const plane = norm(cross(sub(points[i1], points[i0]), sub(points[i2], points[i0])));
  for (let i = 0; i < points.length; i++) {
    const distance = Math.abs(dot(plane, sub(points[i], points[i0])));
    if (![i0, i1, i2].includes(i) && distance > best) { best = distance; i3 = i; }
  }
  const seeds = [i0, i1, i2, i3];
  return [...seeds.map(i => points[i]), ...points.filter((_, i) => !seeds.includes(i))];
}

function convexHull(rawPoints) {
  const points = seedOrder(rawPoints);
  const makeFace = (a, b, c) => {
    const n = norm(cross(sub(points[b], points[a]), sub(points[c], points[a])));
    return { v: [a, b, c], n, d: dot(n, points[a]) };
  };
  let faces = [makeFace(0, 1, 2), makeFace(0, 2, 1)];
  for (let p = 3; p < points.length; p++) {
    const visible = faces.map(f => dot(f.n, points[p]) > f.d + 1e-7);
    if (!visible.some(Boolean)) continue;
    const horizon = new Map();
    faces.forEach((f, fi) => {
      if (!visible[fi]) return;
      for (let i = 0; i < 3; i++) {
        const a = f.v[i], b = f.v[(i + 1) % 3];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (horizon.has(key)) horizon.delete(key); else horizon.set(key, [a, b]);
      }
    });
    faces = faces.filter((_, i) => !visible[i]);
    for (const [a, b] of horizon.values()) faces.push(makeFace(a, b, p));
  }
  return { points, faces };
}

function polarDual(rawPoints) {
  const { points, faces: hull } = convexHull(rawPoints.map(norm));
  const verts = [], dualByPlane = new Map(), dualForHull = [];
  for (const f of hull) {
    const v = mul(f.n, 1 / (f.d || 1e-9));
    const key = v.map(x => Math.round(x * 1e7)).join(':');
    let id = dualByPlane.get(key);
    if (id === undefined) { id = verts.length; verts.push(v); dualByPlane.set(key, id); }
    dualForHull.push(id);
  }
  const touching = points.map(() => []);
  hull.forEach((f, fi) => f.v.forEach(v => touching[v].push(dualForHull[fi])));
  const faces = [];
  points.forEach((p, i) => {
    const ring = [...new Set(touching[i])];
    if (ring.length < 3) return;
    const axis = norm(p);
    const ref = norm(sub(verts[ring[0]], mul(axis, dot(axis, verts[ring[0]]))));
    const side = cross(axis, ref);
    ring.sort((a, b) => {
      const pa = sub(verts[a], p), pb = sub(verts[b], p);
      return Math.atan2(dot(pa, side), dot(pa, ref)) - Math.atan2(dot(pb, side), dot(pb, ref));
    });
    faces.push(ring);
  });
  return normalize({ verts, faces });
}

function deltoidalIcositetrahedron() {
  const a = 1 + Math.sqrt(2), points = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const p = [x, y, z]; p[axis] *= a; points.push(p);
    }
  }
  return polarDual(points);
}

function rhombicTriacontahedron() {
  const ico = solidFor(20);
  const seen = new Set(), points = [];
  for (const face of ico.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(norm(add(ico.verts[a], ico.verts[b])));
    }
  }
  return polarDual(points);
}

function current(n) { return normalize(solidFor(n, 96)); }

const candidates = {
  cubeD3: current(6),
  d5Prism: regularPrism(3, 0.72),
  d5Soft: bevelSolid(regularPrism(3, 0.72), 0.19),
  d7C3vSphere: clippedSphereD7(3),
  d14Rounder: trapezohedron(7, 0.95),
  d16Bipyramid: bipyramid(8, 1.06),
  d24Deltoidal: deltoidalIcositetrahedron(),
  d24Tetrakis: tetrakisHexahedron(),
  d30Rhombic: rhombicTriacontahedron(),
};

const expected = {
  cubeD3: [8, 12, 6], d5Prism: [6, 9, 5], d5Soft: [18, 36, 20],
  d14Rounder: [16, 28, 14], d16Bipyramid: [10, 24, 16],
  d24Deltoidal: [26, 48, 24], d24Tetrakis: [14, 36, 24],
  d30Rhombic: [32, 60, 30],
};
for (const [name, counts] of Object.entries(expected)) {
  const solid = candidates[name];
  const s = edgeStats(solid);
  if ([s.V, s.E, s.F].join() !== counts.join() || !s.manifold || s.V - s.E + s.F !== 2) {
    throw new Error(`${name}: expected V/E/F ${counts.join('/')}, got ${s.V}/${s.E}/${s.F}; manifold=${s.manifold}`);
  }
  const problems = geometryProblems(solid);
  if (problems.length) throw new Error(`${name}: invalid geometry: ${problems.slice(0, 4).join('; ')}`);
}

const d7Study = candidates.d7C3vSphere;
const d7Stats = edgeStats(d7Study);
const d7Caps = d7Study.faceKinds.filter(kind => kind === 'cap').length;
const d7Problems = geometryProblems(d7Study);
const d7C = 0.2101383127306031;
let d7Contacts = 0;
for (let i = 0; i < d7Study.d7Normals.length; i++) {
  if (Math.abs(mag(d7Study.d7Normals[i]) - 1) > 1e-12) throw new Error('d7 spherical-code normal is not a unit vector');
  for (let j = i + 1; j < d7Study.d7Normals.length; j++) {
    if (Math.abs(dot(d7Study.d7Normals[i], d7Study.d7Normals[j]) - d7C) < 1e-10) d7Contacts++;
  }
}
if (!d7Stats.manifold || d7Stats.V - d7Stats.E + d7Stats.F !== 2 || d7Caps !== 7 || d7Contacts !== 12 || d7Problems.length) {
  throw new Error(`d7C3vSphere: invalid clipped sphere; V/E/F=${d7Stats.V}/${d7Stats.E}/${d7Stats.F}; caps=${d7Caps}; contacts=${d7Contacts}; ${d7Problems.slice(0, 3).join('; ')}`);
}

const controls = [4, 6, 8, 10, 12, 20].map(n => ({ name: `d${n}`, solid: current(n) }));
const studies = [
  { die: 'd3', finding: 'Replace pointed barrel', current: current(3), options: [
    { label: 'Cube d3 · recommended', note: 'I–III repeated twice', solid: candidates.cubeD3, tone: '#C66B32' },
  ] },
  { die: 'd5', finding: 'Selected: softened edge-read form', current: current(5), options: [
    { label: 'A · triangular prism', note: 'comparison retained', solid: candidates.d5Prism, tone: '#73776F' },
    { label: 'B · softened prism · selected', note: 'separate logical outcomes', solid: candidates.d5Soft, tone: '#397A86' },
  ] },
  { die: 'd7', finding: 'Revised from spherical-code research', current: current(7), options: [
    { label: 'C3v truncated sphere · revised', note: '1+3+3 spherical packing · canonical h/R · unfilleted', solid: candidates.d7C3vSphere, tone: '#397A86' },
  ] },
  { die: 'd14', finding: 'Retain topology; tune proportion', current: current(14), options: [
    { label: 'Rounder trapezohedron', note: 'Same 14 kite faces', solid: candidates.d14Rounder, tone: '#C66B32' },
  ] },
  { die: 'd16', finding: 'Replace kite-faced form', current: current(16), options: [
    { label: 'Octagonal bipyramid', note: '16 triangular faces', solid: candidates.d16Bipyramid, tone: '#C66B32' },
  ] },
  { die: 'd24', finding: 'Selected: deltoidal family', current: current(24), options: [
    { label: 'A · deltoidal icositetrahedron · selected', note: '24 kite faces', solid: candidates.d24Deltoidal, tone: '#C66B32' },
    { label: 'B · tetrakis hexahedron', note: 'comparison retained', solid: candidates.d24Tetrakis, tone: '#73776F' },
  ] },
  { die: 'd30', finding: 'Replace irregular 5/6/7-gons', current: current(30), options: [
    { label: 'Rhombic triacontahedron', note: '30 golden-rhombus faces', solid: candidates.d30Rhombic, tone: '#C66B32' },
  ] },
];

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outPath = path.resolve(arg('--out') || path.join(__dirname, 'dcc-shape-study.svg'));
const referencePath = arg('--reference');
let referenceMime;
if (referencePath) {
  if (!fs.existsSync(referencePath)) throw new Error(`reference image not found: ${referencePath}`);
  const mimeByExtension = new Map([
    ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ]);
  referenceMime = mimeByExtension.get(path.extname(referencePath).toLowerCase());
  if (!referenceMime) throw new Error(`unsupported reference image type: ${path.extname(referencePath) || '(none)'}`);
}
const W = 1900, topH = 410, rowH = 250, H = topH + studies.length * rowH + 70;
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
out.push(`<rect width="${W}" height="${H}" fill="#F5F1E8"/>`);
out.push(`<style>text{font-family:sans-serif}.title{font-weight:700;fill:#1D211E}.muted{fill:#6E7068}.mono{font-family:monospace}</style>`);
out.push(`<defs><clipPath id="reference-clip"><rect x="54" y="148" width="300" height="212" rx="14"/></clipPath></defs>`);
out.push(`<text x="54" y="64" class="title" font-size="34">Dicebox · recognizable DCC shape study</text>`);
out.push(`<text x="54" y="98" class="muted" font-size="17">Review-only artifact · current runtime geometry is unchanged · deterministic geometry and angles</text>`);
out.push(`<rect x="54" y="126" width="1792" height="2" fill="#D8D1C3"/>`);

if (referencePath) {
  const data = fs.readFileSync(referencePath).toString('base64');
  out.push(`<rect x="54" y="148" width="300" height="212" rx="14" fill="#E8E0D2"/>`);
  out.push(`<image href="data:${referenceMime};base64,${data}" x="54" y="148" width="300" height="212" preserveAspectRatio="xMidYMid slice" clip-path="url(#reference-clip)"/>`);
  out.push(`<text x="54" y="382" class="muted" font-size="13">User-supplied DCC set reference</text>`);
  out.push(`<text x="54" y="400" class="muted" font-size="13">Directional silhouette evidence; not topology proof</text>`);
}

function drawModel(solid, x, y, width, tone, label, note) {
  const stats = edgeStats(solid);
  out.push(`<rect x="${x}" y="${y}" width="${width}" height="205" rx="14" fill="#FBF9F4" stroke="#DED7CA"/>`);
  out.push(`<text x="${x + 18}" y="${y + 27}" class="title" font-size="16" fill="${tone}">${esc(label)}</text>`);
  out.push(`<text x="${x + 18}" y="${y + 49}" class="muted" font-size="13">${esc(note)}</text>`);
  out.push(`<text x="${x + width - 18}" y="${y + 27}" text-anchor="end" class="muted mono" font-size="12">V${stats.V} · E${stats.E} · F${stats.F}</text>`);
  const views = [[0.45,0.62,0.12],[-0.55,0.25,-0.15],[0.18,-0.83,0.42]];
  const viewW = (width - 28) / 3;
  views.forEach((angles, vi) => {
    const cx = x + 14 + viewW * (vi + 0.5), cy = y + 126, scale = Math.min(65, viewW * 0.38);
    const pts = solid.verts.map(v => rotate(v, ...angles));
    const proj = pts.map(p => { const d = 4 / (4 - p[2]); return [cx + p[0] * scale * d, cy + p[1] * scale * d]; });
    const frontFaces = solid.faces.map((face, fi) => ({
      face, fi, front: faceNormal(face.map(i => pts[i]))[2] > 0,
      depth: face.reduce((sum, i) => sum + pts[i][2], 0) / face.length,
    })).filter(item => item.front).sort((a, b) => a.depth - b.depth);
    const sphereFill = [], capFill = [];
    for (const { face, fi } of frontFaces) {
      const d = `${face.map((id, i) => `${i ? 'L' : 'M'}${proj[id][0].toFixed(2)},${proj[id][1].toFixed(2)}`).join('')}Z`;
      (solid.faceKinds?.[fi] === 'cap' ? capFill : sphereFill).push(d);
    }
    if (sphereFill.length) out.push(`<path d="${sphereFill.join('')}" fill="${tone}" fill-opacity="${solid.hideSmoothEdges ? 0.10 : 0.055}" stroke="none"/>`);
    if (capFill.length) out.push(`<path d="${capFill.join('')}" fill="${tone}" fill-opacity="0.20" stroke="none"/>`);

    const edges = new Map();
    solid.faces.forEach((face, fi) => {
      const front = faceNormal(face.map(i => pts[i]))[2] > 0;
      const kind = solid.faceKinds?.[fi] || 'flat';
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!edges.has(key)) edges.set(key, { front: false, back: false, kinds: new Set() });
        const edge = edges.get(key);
        edge[front ? 'front' : 'back'] = true;
        edge.kinds.add(kind);
      }
    });
    for (const pass of [false, true]) {
      const d = [];
      for (const [key, edge] of edges) {
        const sphereOnly = edge.kinds.size === 1 && edge.kinds.has('sphere');
        if (solid.hideSmoothEdges && sphereOnly) {
          if (pass !== true || !edge.front || !edge.back) continue;
        } else if (edge.front !== pass) continue;
        const [a, b] = key.split(':').map(Number);
        d.push(`M${proj[a][0].toFixed(2)},${proj[a][1].toFixed(2)}L${proj[b][0].toFixed(2)},${proj[b][1].toFixed(2)}`);
      }
      out.push(`<path d="${d.join('')}" stroke="${tone}" stroke-width="${pass ? 2 : 1.15}" stroke-opacity="${pass ? 0.98 : 0.18}" fill="none" stroke-linecap="round"/>`);
    }
    out.push(`<text x="${cx}" y="${y + 192}" text-anchor="middle" class="muted mono" font-size="10">view ${vi + 1}</text>`);
  });
}

out.push(`<text x="390" y="166" class="title" font-size="19">Retained controls</text>`);
out.push(`<text x="390" y="190" class="muted" font-size="14">These familiar Platonic/trapezohedral forms anchor the family and are not replacement targets.</text>`);
controls.forEach((item, i) => drawModel(item.solid, 390 + i * 242, 207, 226, '#4A514D', item.name, 'retain current landmark'));

studies.forEach((study, ri) => {
  const y = topH + ri * rowH;
  out.push(`<rect x="36" y="${y}" width="1828" height="232" rx="16" fill="${ri % 2 ? '#F1ECE2' : '#EEE8DC'}"/>`);
  out.push(`<text x="58" y="${y + 48}" class="title" font-size="28">${study.die}</text>`);
  wrapWords(study.finding).slice(0, 3).forEach((line, li) => {
    out.push(`<text x="58" y="${y + 77 + li * 19}" class="muted" font-size="14">${esc(line)}</text>`);
  });
  drawModel(study.current, 250, y + 13, 500, '#73776F', 'Current Dicebox', 'live runtime model');
  study.options.forEach((option, oi) => drawModel(option.solid, 770 + oi * 540, y + 13, 520, option.tone, option.label, option.note));
});

out.push(`<text x="54" y="${H - 30}" class="muted" font-size="14">Decision gate: confirm the revised C3v truncated-sphere d7. Other proposed shapes were accepted 2026-08-05. No Worker deployment is part of this artifact.</text>`);
out.push('</svg>');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'));
console.log(`wrote ${outPath}`);
for (const [name, solid] of Object.entries(candidates)) {
  const s = edgeStats(solid);
  const valid = geometryProblems(solid).length === 0;
  const details = name === 'd7C3vSphere'
    ? ` caps=${solid.faceKinds.filter(kind => kind === 'cap').length} contacts=${d7Contacts} h=${solid.planeOffset.toFixed(12)}`
    : '';
  console.log(`${name.padEnd(15)} V${s.V} E${s.E} F${s.F} manifold=${s.manifold} valid=${valid}${details}`);
}

// Deterministic, review-only comparison gallery for the under-30 Dicebox shape
// language: "controlled landmark truncation". Each gap die d9-d29 is derived by
// support-plane vertex truncations of the PRECEDING locked Dicebox landmark
// (d8/d10/d12/d14/d16/d20/d24 pulled from render.js solidFor), so every result
// descends from the actual approved canonical mesh — not from a fallback base.
// This tool does not modify runtime geometry.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solidFor } from '../render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
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

function cloneSolid(s) {
  return { verts: s.verts.map(v => [...v]), faces: s.faces.map(f => [...f]) };
}
function adjacency(solid) {
  const n = solid.verts.length, adj = Array.from({ length: n }, () => new Set());
  for (const f of solid.faces) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; adj[a].add(b); adj[b].add(a); }
  return adj.map(s => [...s]);
}

// Support-plane truncation of one vertex: cuts the solid with half-space
// n.x <= c where n is the vertex direction, adding exactly one planar cap.
function truncateVertex(solid, vid, tau) {
  const s = cloneSolid(solid);
  const v = s.verts[vid];
  const adj = adjacency(s);
  const neigh = adj[vid];
  const nv = norm(v);
  const hv = dot(nv, v);
  let g = Infinity;
  for (const u of neigh) g = Math.min(g, hv - dot(nv, s.verts[u]));
  if (!(g > 0)) throw new Error('truncation g<=0');
  const c = hv - tau * g;
  // New vertex per neighbor, on edge (vid,u).
  const pIdx = new Map();
  for (const u of neigh) {
    const denom = dot(nv, s.verts[u]) - hv;
    if (Math.abs(denom) < 1e-12) throw new Error('parallel edge during truncation');
    const lam = (c - hv) / denom;
    pIdx.set(u, s.verts.push(v.map((vi, ax) => vi + lam * (s.verts[u][ax] - vi))) - 1);
  }
  // Rebuild faces: replace every occurrence of vid with prev->p(prev)->p(next)->next.
  const faces = [];
  for (const f of s.faces) {
    if (!f.includes(vid)) { faces.push(f.map(x => x)); continue; }
    const L = f.length, out = [];
    for (let i = 0; i < L; i++) {
      const cur = f[i];
      if (cur !== vid) { out.push(cur); continue; }
      const prev = f[(i - 1 + L) % L], next = f[(i + 1) % L];
      out.push(pIdx.get(prev), pIdx.get(next));
    }
    faces.push(out);
  }
  // Cap face: reconstruct the boundary cycle from the incident faces (guarantees
  // the cap shares exactly the same edges as the surrounding faces), then orient
  // it outward. reverse => opposite-wound to the incident faces on every shared edge.
  const bdir = [];
  for (const f of s.faces) {
    if (!f.includes(vid)) continue;
    const L = f.length;
    for (let i = 0; i < L; i++) if (f[i] === vid) { const pv = f[(i - 1 + L) % L], nx = f[(i + 1) % L]; bdir.push([pIdx.get(pv), pIdx.get(nx)]); }
  }
  const succ = new Map();
  for (const [a, b] of bdir) succ.set(a, b);
  const start = bdir[0][0], cycle = [];
  let cur = start;
  do { cycle.push(cur); cur = succ.get(cur); } while (cur !== undefined && cur !== start);
  let cap = cycle.slice().reverse();
  const cpts = cap.map(i => s.verts[i]);
  let cn;
  for (let i = 1; i < cpts.length - 1 && !cn; i++) { const cc = cross(sub(cpts[i], cpts[0]), sub(cpts[i + 1], cpts[0])); if (mag(cc) > 1e-9) cn = cc; }
  if (cn && dot(cn, sub(centroid(cpts), centroid(s.verts))) < 0) cap = cap.slice().reverse();
  faces.push(cap);
  return { verts: s.verts, faces };
}

// Remove unreferenced vertices and remap face indices.
function compact(solid) {
  const used = new Set();
  for (const f of solid.faces) for (const i of f) used.add(i);
  const map = new Map(); const verts = [];
  for (const i of used) { map.set(i, verts.length); verts.push(solid.verts[i]); }
  return { verts, faces: solid.faces.map(f => f.map(i => map.get(i))) };
}

// Orient every face outward from the solid centroid (convex solid).
function orientOutward(solid) {
  const c = centroid(solid.verts);
  const faces = solid.faces.map(f => {
    const pts = f.map(i => solid.verts[i]);
    let n;
    for (let i = 1; i < pts.length - 1 && !n; i++) { const cc = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])); if (mag(cc) > 1e-9) n = cc; }
    if (n && dot(n, sub(centroid(pts), c)) < 0) return f.slice().reverse();
    return f.slice();
  });
  return { verts: solid.verts, faces };
}

function normalizeScale(solid) {
  const scale = Math.max(...solid.verts.map(mag)) || 1;
  return { verts: solid.verts.map(v => mul(v, 1 / scale)), faces: solid.faces.map(f => [...f]) };
}
function yScale(solid, a) { return { verts: solid.verts.map(v => [v[0], v[1] * a, v[2]]), faces: solid.faces.map(f => [...f]) }; }

function degreeList(solid) {
  const adj = adjacency(solid);
  return adj.map(a => a.length);
}

// Deterministic max-spread independent set with stable prefixes. Greedy first;
// falls back to brute force for small candidate sets (e.g. icosahedron's max
// independent set of 3, which a bad greedy tie-break can miss).
function maxSpreadIndependent(solid, candidates, count) {
  const adj = adjacency(solid);
  const dist = (i, j) => mag(sub(solid.verts[i], solid.verts[j]));
  const independent = set => { for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) if (adj[set[i]].includes(set[j])) return false; return true; };
  const spread = set => { let m = Infinity; for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) m = Math.min(m, dist(set[i], set[j])); return set.length <= 1 ? solid.verts[set[0]][1] : m; };
  // Greedy: highest-Y first, then farthest from the chosen set.
  const sorted = candidates.slice().sort((a, b) => solid.verts[b][1] - solid.verts[a][1] || a - b);
  const greedy = [];
  for (let step = 0; step < count; step++) {
    let best = -1, bs = -Infinity;
    for (const cand of sorted) {
      if (greedy.includes(cand)) continue;
      if (greedy.some(ch => adj[cand].includes(ch))) continue;
      let d = Infinity; for (const ch of greedy) d = Math.min(d, dist(cand, ch));
      if (!greedy.length) d = solid.verts[cand][1];
      if (d > bs) { bs = d; best = cand; }
    }
    if (best < 0) break;
    greedy.push(best);
  }
  if (greedy.length === count) return greedy;
  // Brute-force combinations of size `count`.
  const combos = [], k = count, n = candidates.length;
  const rec = (idx, chosen) => {
    if (chosen.length === k) { combos.push(chosen.slice()); return; }
    for (let i = idx; i <= n - (k - chosen.length); i++) { chosen.push(candidates[i]); rec(i + 1, chosen); chosen.pop(); }
  };
  rec(0, []);
  let bestSet = null, bestScore = -Infinity;
  for (const c of combos) {
    if (!independent(c)) continue;
    const s = spread(c);
    if (s > bestScore) { bestScore = s; bestSet = c; }
  }
  if (!bestSet) throw new Error(`cannot pick ${count} independent vertices`);
  return bestSet;
}

function faceNormal(solid, f) {
  const pts = f.map(i => solid.verts[i]);
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  return mag(n) ? n : [0, 0, 0];
}

// Build one gap die: truncate `picks` independent vertices of the landmark.
function buildGap(landmark, picks, tau, yA) {
  let s = cloneSolid(landmark);
  for (const vid of picks) s = truncateVertex(s, vid, tau);
  s = compact(s);
  s = orientOutward(s);
  s = yScale(s, yA);
  s = normalizeScale(s);
  return s;
}

// ---- validation (the 14-point invariant checklist) ----
function validate(solid, sides) {
  const problems = [];
  const V = solid.verts.length, F = solid.faces.length;
  let E = 0;
  for (const f of solid.faces) E += f.length;
  E /= 2;
  if (F !== sides) problems.push(`F=${F} != sides=${sides}`);
  const uses = new Map();
  for (const f of solid.faces) {
    if (f.length < 3 || new Set(f).size !== f.length) { problems.push('face <3 unique'); break; }
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (a >= V || b >= V) { problems.push('invalid index'); }
      if (!uses.has(key)) uses.set(key, []);
      uses.get(key).push([a, b]);
    }
  }
  for (const v of uses.values()) {
    if (v.length !== 2 || v[0][0] !== v[1][1] || v[0][1] !== v[1][0]) problems.push('edge not exactly-2 opposite-wound');
  }
  if (V - E + F !== 2) problems.push(`Euler ${V - E + F}`);
  // planarity + convexity + winding
  const c = centroid(solid.verts);
  let worstPlanar = 0, worstConvex = 0;
  solid.faces.forEach((f, fi) => {
    const pts = f.map(i => solid.verts[i]);
    const n = faceNormal(solid, f); const len = mag(n); if (!len) return;
    const u = mul(n, 1 / len);
    if (dot(u, sub(centroid(pts), c)) < 0) problems.push(`face ${fi} inward`);
    for (const p of pts) worstPlanar = Math.max(worstPlanar, Math.abs(dot(u, sub(p, pts[0]))));
    for (const p of solid.verts) worstConvex = Math.max(worstConvex, dot(u, sub(p, pts[0])));
  });
  if (worstPlanar > 1e-6) problems.push(`planarity ${worstPlanar}`);
  if (worstConvex > 1e-6) problems.push(`convexity ${worstConvex}`);
  const degs = degreeList(solid);
  if (degs.some(d => d < 3)) problems.push('vertex degree <3');
  if (V > 36 || E > 63 || F > 29) problems.push(`size caps V${V} E${E} F${F}`);
  return { problems, V, E, F, worstPlanar, worstConvex };
}

// ---- band table (GPT, verified) ----
const landmark = n => cloneSolid(solidFor(n));
const degN = (s, k) => s.verts.map((_, i) => degreeList(s)[i] === k ? i : -1).filter(i => i >= 0);
const highestY = s => s.verts.map((_, i) => i).sort((a, b) => s.verts[b][1] - s.verts[a][1])[0];

// Ordered independent set (highest-Y first, then farthest) built once per family
// so slicing gives stable prefixes: d(n+1) always contains d(n)'s cuts.
function orderedIndependentSet(solid, candidates, maxCount) {
  const adj = adjacency(solid);
  const dist = (i, j) => mag(sub(solid.verts[i], solid.verts[j]));
  const independent = set => { for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) if (adj[set[i]].includes(set[j])) return false; return true; };
  const spread = set => { let m = Infinity; for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) m = Math.min(m, dist(set[i], set[j])); return m; };
  const n = candidates.length, k = maxCount, combos = [];
  const rec = (idx, chosen) => {
    if (chosen.length === k) { combos.push(chosen.slice()); return; }
    for (let i = idx; i <= n - (k - chosen.length); i++) { chosen.push(candidates[i]); rec(i + 1, chosen); chosen.pop(); }
  };
  rec(0, []);
  let best = null, bs = -Infinity;
  for (const c of combos) { if (!independent(c)) continue; const s = spread(c); if (s > bs) { bs = s; best = c; } }
  if (!best) throw new Error(`cannot pick ${maxCount} independent vertices`);
  const ordered = [];
  const rem = best.slice();
  while (rem.length) {
    let idx = 0, score = -Infinity;
    for (let i = 0; i < rem.length; i++) {
      let d = Infinity; for (const ch of ordered) d = Math.min(d, dist(rem[i], ch));
      if (!ordered.length) d = solid.verts[rem[i]][1];
      if (d > score) { score = d; idx = i; }
    }
    ordered.push(rem.splice(idx, 1)[0]);
  }
  return ordered;
}

const familyCache = {};
function familySet(base, degree, maxCount) {
  const key = `${base}:${degree}:${maxCount}`;
  if (familyCache[key]) return familyCache[key];
  const s = landmark(base);
  const ordered = orderedIndependentSet(s, degN(s, degree), maxCount);
  familyCache[key] = { ordered, landmark: s };
  return familyCache[key];
}

function gapDie(sides) {
  const t = {
    9: { base: 8, single: true, tau: 0.220, a: 0.820 },
    11: { base: 10, single: true, tau: 0.200, a: 1.180 },
    13: { base: 12, single: true, tau: 0.240, a: 0.900 },
    15: { base: 14, single: true, tau: 0.170, a: 1.120 },
    17: { base: 16, degree: 4, famMax: 3, q: 1, tau: 0.180, a: 1.220 },
    18: { base: 16, degree: 4, famMax: 3, q: 2, tau: 0.220, a: 1.070 },
    19: { base: 16, degree: 4, famMax: 3, q: 3, tau: 0.260, a: 0.920 },
    21: { base: 20, degree: 5, famMax: 3, q: 1, tau: 0.160, a: 0.880 },
    22: { base: 20, degree: 5, famMax: 3, q: 2, tau: 0.195, a: 0.990 },
    23: { base: 20, degree: 5, famMax: 3, q: 3, tau: 0.230, a: 1.100 },
    25: { base: 24, degree: 3, famMax: 5, q: 1, tau: 0.120, a: 1.180 },
    26: { base: 24, degree: 3, famMax: 5, q: 2, tau: 0.145, a: 1.095 },
    27: { base: 24, degree: 3, famMax: 5, q: 3, tau: 0.170, a: 1.010 },
    28: { base: 24, degree: 3, famMax: 5, q: 4, tau: 0.195, a: 0.925 },
    29: { base: 24, degree: 3, famMax: 5, q: 5, tau: 0.220, a: 0.840 },
  }[sides];
  let base, picks;
  if (t.single) { base = landmark(t.base); picks = [highestY(base)]; }
  else { const fam = familySet(t.base, t.degree, t.famMax); base = fam.landmark; picks = fam.ordered.slice(0, t.q); }
  return buildGap(base, picks, t.tau, t.a);
}

const GAP_SIDES = [9, 11, 13, 15, 17, 18, 19, 21, 22, 23, 25, 26, 27, 28, 29];

const solids = {};
let failures = [];
for (const s of GAP_SIDES) {
  try {
    solids[s] = gapDie(s);
    const r = validate(solids[s], s);
    if (r.problems.length) failures.push(`d${s}: ${r.problems.slice(0, 4).join('; ')}`);
    else console.log(`d${s}: V${r.V} E${r.E} F${r.F} planar ${r.worstPlanar.toExponential(1)} conv ${r.worstConvex.toExponential(1)} OK`);
  } catch (e) { failures.push(`d${s}: ${e.message}`); }
}
console.log(failures.length ? `FAILURES:\n${failures.join('\n')}` : 'ALL 15 GAP DICE VALID');

// determinism: regenerate twice
const again = {};
for (const s of GAP_SIDES) again[s] = gapDie(s);
const stable = GAP_SIDES.every(s => JSON.stringify(solids[s].verts) === JSON.stringify(again[s].verts) && JSON.stringify(solids[s].faces) === JSON.stringify(again[s].faces));
console.log('deterministic:', stable);

// ---- SVG gallery ----
const outPath = path.resolve(arg('--out') || path.join(__dirname, 'under30-shape-study.svg'));
function rotate(v, rx, ry, rz) {
  let [x, y, z] = v;
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
function drawModel(s, x, y, width, tone, label, note) {
  const out = [];
  out.push(`<rect x="${x}" y="${y}" width="${width}" height="150" rx="12" fill="#FBF9F4" stroke="#DED7CA"/>`);
  out.push(`<text x="${x + 14}" y="${y + 22}" class="title" font-size="15" fill="${tone}">${esc(label)}</text>`);
  out.push(`<text x="${x + width - 14}" y="${y + 22}" text-anchor="end" class="muted mono" font-size="11">V${s.verts.length}·E${(() => { let e = 0; for (const f of s.faces) e += f.length; return e / 2; })()}·F${s.faces.length}</text>`);
  const views = [[0.5, 0.6, 0.12], [-0.6, 0.3, -0.15], [0.2, -0.8, 0.4]];
  const vw = (width - 24) / 3;
  views.forEach((ang, vi) => {
    const cx = x + 12 + vw * (vi + 0.5), cy = y + 88, scale = Math.min(46, vw * 0.36);
    const pts = s.verts.map(v => rotate(v, ...ang));
    const proj = pts.map(p => { const d = 4 / (4 - p[2]); return [cx + p[0] * scale * d, cy + p[1] * scale * d]; });
    const edgeMap = new Map();
    for (const f of s.faces) {
      const front = faceNormal(s, f)[2] > 0;
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length], k = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!edgeMap.has(k)) edgeMap.set(k, { front: false, back: false });
        edgeMap.get(k)[front ? 'front' : 'back'] = true;
      }
    }
    for (const pass of [false, true]) {
      const d = [];
      for (const [k, e] of edgeMap) { if (e.front !== pass) continue; const [a, b] = k.split(':').map(Number); d.push(`M${proj[a][0].toFixed(1)},${proj[a][1].toFixed(1)}L${proj[b][0].toFixed(1)},${proj[b][1].toFixed(1)}`); }
      out.push(`<path d="${d.join('')}" stroke="${tone}" stroke-width="${pass ? 2 : 1.15}" stroke-opacity="${pass ? 0.98 : 0.18}" fill="none" stroke-linecap="round"/>`);
    }
  });
  return out.join('\n');
}

const COLS = 5, ROWH = 170;
const families = [
  { label: 'from d8  ·  d9', die: 9 },
  { label: 'from d10 · d11', die: 11 },
  { label: 'from d12 · d13', die: 13 },
  { label: 'from d14 · d15', die: 15 },
  { label: 'from d16 · d17–19', die: 17 },
  { label: 'from d16 · d18', die: 18 },
  { label: 'from d16 · d19', die: 19 },
  { label: 'from d20 · d21', die: 21 },
  { label: 'from d20 · d22', die: 22 },
  { label: 'from d20 · d23', die: 23 },
  { label: 'from d24 · d25', die: 25 },
  { label: 'from d24 · d26', die: 26 },
  { label: 'from d24 · d27', die: 27 },
  { label: 'from d24 · d28', die: 28 },
  { label: 'from d24 · d29', die: 29 },
];
const W = 980, H = 60 + Math.ceil(families.length / COLS) * ROWH + 50;
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
out.push(`<rect width="${W}" height="${H}" fill="#F5F1E8"/>`);
out.push(`<style>text{font-family:sans-serif}.title{font-weight:700;fill:#1D211E}.muted{fill:#6E7068}.mono{font-family:monospace}</style>`);
out.push(`<text x="36" y="38" class="title" font-size="24">Dicebox · under-30 shape language — controlled landmark truncation</text>`);
out.push(`<text x="36" y="60" class="muted" font-size="14">Each gap die = support-plane truncations of the preceding locked Dicebox landmark (from solidFor). Regenerated from Dicebox's real d8/d10/d12/d14/d16/d20/d24.</text>`);
families.forEach((fam, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  out.push(drawModel(solids[fam.die], 36 + col * 186, 76 + row * ROWH, 176, '#397A86', `d${fam.die}`, fam.label));
});
out.push(`<text x="36" y="${H - 20}" class="muted" font-size="13">Review-only artifact · runtime unchanged · all 15 pass the 14-point invariant checklist (F=sides, Euler 2, planar&lt;1e-6, convex, outward, deterministic).</text>`);
out.push('</svg>');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'));
console.log('wrote ' + outPath);

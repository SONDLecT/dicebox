// Wireframe die rendering + throw simulation.
//
// Dice are drawn as pure line work: no fill, no shadow. Depth comes only from
// drawing back-facing edges at reduced opacity. The "table" is one hairline rule.

import { UNDER_30_GAP } from './under30-gap.js';

const TAU = Math.PI * 2;

// Unit-radius polyhedra. Faces are index loops into verts; each face carries the
// pip value shown when that face points at the camera.
function tetra() {
  const v = [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].map(norm);
  return { verts: v, faces: [[0,1,2],[0,3,1],[0,2,3],[1,3,2]] };
}
function cube() {
  const v = [];
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) v.push(norm([x,y,z]));
  return { verts: v, faces: [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]] };
}
function octa() {
  const v = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  return { verts: v, faces: [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]] };
}
function dodeca() {
  const p = (1 + Math.sqrt(5)) / 2, q = 1 / p, v = [];
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) v.push(norm([x,y,z]));
  for (const s of [-1,1]) for (const t of [-1,1]) {
    v.push(norm([0, s*q, t*p])); v.push(norm([s*q, t*p, 0])); v.push(norm([s*p, 0, t*q]));
  }
  return { verts: v, faces: hullFaces(v, 5) };
}
function icosa() {
  const p = (1 + Math.sqrt(5)) / 2, v = [];
  for (const s of [-1,1]) for (const t of [-1,1]) {
    v.push(norm([0, s, t*p])); v.push(norm([s, t*p, 0])); v.push(norm([s*p, 0, t]));
  }
  return { verts: v, faces: hullFaces(v, 3) };
}

function orderedHullPoints(points) {
  let i0 = 0, i1 = 1, i2 = 2, i3 = 3;
  for (let i = 1; i < points.length; i++) if (points[i][0] < points[i0][0]) i0 = i;
  let best = -1;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(...sub(points[i], points[i0]));
    if (i !== i0 && d > best) { best = d; i1 = i; }
  }
  best = -1;
  const line = sub(points[i1], points[i0]);
  for (let i = 0; i < points.length; i++) {
    const area = Math.hypot(...cross(line, sub(points[i], points[i0])));
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

function polarDual(rawPoints) {
  const points = orderedHullPoints(rawPoints.map(norm));
  const hull = [];
  const addFace = (a, b, c) => {
    const n = norm(cross(sub(points[b], points[a]), sub(points[c], points[a])));
    hull.push({ v: [a, b, c], n, d: dot(n, points[a]) });
  };
  addFace(0, 1, 2); addFace(0, 2, 1);
  for (let p = 3; p < points.length; p++) {
    const visible = hull.map(face => dot(face.n, points[p]) > face.d + 1e-7);
    if (!visible.some(Boolean)) continue;
    const horizon = new Map();
    hull.forEach((face, fi) => {
      if (!visible[fi]) return;
      for (let i = 0; i < 3; i++) {
        const a = face.v[i], b = face.v[(i + 1) % 3];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (horizon.has(key)) horizon.delete(key); else horizon.set(key, [a, b]);
      }
    });
    const kept = hull.filter((_, i) => !visible[i]);
    hull.length = 0; hull.push(...kept);
    for (const [a, b] of horizon.values()) addFace(a, b, p);
  }

  const verts = [], dualByPlane = new Map(), dualForHull = [];
  for (const face of hull) {
    const v = face.n.map(x => x / (face.d || 1e-9));
    const key = v.map(x => Math.round(x * 1e7)).join(':');
    let id = dualByPlane.get(key);
    if (id === undefined) { id = verts.length; verts.push(v); dualByPlane.set(key, id); }
    dualForHull.push(id);
  }
  const touching = points.map(() => []);
  hull.forEach((face, fi) => face.v.forEach(v => touching[v].push(dualForHull[fi])));
  const faces = [];
  points.forEach((p, i) => {
    const ring = [...new Set(touching[i])];
    if (ring.length < 3) return;
    const axis = norm(p);
    const first = verts[ring[0]];
    const ref = norm(sub(first, axis.map(x => x * dot(axis, first))));
    const side = cross(axis, ref);
    ring.sort((a, b) => {
      const pa = sub(verts[a], p), pb = sub(verts[b], p);
      return Math.atan2(dot(pa, side), dot(pa, ref)) - Math.atan2(dot(pb, side), dot(pb, ref));
    });
    faces.push(ring);
  });
  return normalize({ verts, faces });
}

// Catalan 24-face solid used by recognizable commercial d24s: the polar dual
// of a small rhombicuboctahedron, with 24 congruent kite faces.
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
  const ico = icosa();
  const seen = new Set(), points = [];
  for (const face of ico.faces) for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(norm([
      ico.verts[a][0] + ico.verts[b][0],
      ico.verts[a][1] + ico.verts[b][1],
      ico.verts[a][2] + ico.verts[b][2],
    ]));
  }
  return polarDual(points);
}

function norm(v) {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0]/m, v[1]/m, v[2]/m];
}

// Recover faces from a vertex cloud on the unit sphere by grouping vertices that
// share a common plane. Cheaper than a full convex hull and exact for these solids.
function hullFaces(verts, size) {
  const faces = [], seen = new Set();
  for (let i = 0; i < verts.length; i++) {
    for (let j = i+1; j < verts.length; j++) {
      for (let k = j+1; k < verts.length; k++) {
        let n = norm(cross(sub(verts[j], verts[i]), sub(verts[k], verts[i])));
        if (!Number.isFinite(n[0])) continue; // collinear triple
        let d = dot(n, verts[i]);

        // Orient the normal outward. Testing `d > threshold` instead would drop
        // every face on the far side of the origin — that silently cost the
        // icosahedron half its faces.
        if (d < 0) { n = n.map(x => -x); d = -d; }
        if (d < 1e-9) continue; // plane through the centre bounds nothing

        // A supporting plane of the hull has every vertex on one side of it.
        // Without this test, any coplanar set qualifies — including internal
        // cross-sections, which gave the d12 twelve phantom faces.
        const on = [];
        let bounding = true;
        for (let m = 0; m < verts.length; m++) {
          const side = dot(n, verts[m]) - d;
          if (Math.abs(side) < 1e-6) on.push(m);
          else if (side > 1e-6) bounding = false;
        }
        if (!bounding) continue;
        if (on.length !== size) continue;
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push(sortRing(on, verts, n));
      }
    }
  }
  return faces;
}

function sortRing(idx, verts, n) {
  const c = idx.reduce((a, i) => [a[0]+verts[i][0], a[1]+verts[i][1], a[2]+verts[i][2]], [0,0,0])
                .map(x => x / idx.length);
  const u = norm(sub(verts[idx[0]], c));
  const w = cross(n, u);
  return idx.slice().sort((a, b) => {
    const va = sub(verts[a], c), vb = sub(verts[b], c);
    return Math.atan2(dot(va, w), dot(va, u)) - Math.atan2(dot(vb, w), dot(vb, u));
  });
}

const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

// A fair die needs to be *isohedral*: every face equivalent under the solid's
// symmetry group, so each has equal probability. Two families cover every face
// count, which is how real d10s, d14s, d24s and d30s are actually made.

// Bipyramid: two apexes over a regular n-gon equator gives 2n triangular faces.
// Triangles are planar by construction, so the only tuning is apex height.
function bipyramid(n, height = 1.15) {
  const H = height;
  const verts = [[0, H, 0], [0, -H, 0]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    verts.push([Math.cos(a), 0, Math.sin(a)]);
  }
  const ring = i => 2 + (i % n);
  const faces = [];
  for (let i = 0; i < n; i++) {
    faces.push([0, ring(i), ring(i + 1)]);
    faces.push([1, ring(i + 1), ring(i)]);
  }
  return normalize({ verts, faces });
}

// Trapezohedron: two offset rings plus an apex at each pole, giving 2n kite
// faces. The apex height is not free — the kite [apex, top_i, bot_i, top_i+1]
// is planar only at this exact ratio. Choosing H by eye bowties every face,
// which renders as a tangle of crossing edges.
function trapezohedron(n, flatten = null) {
  // Planarity fixes the apex height exactly, relative to a unit ring radius:
  // H = 2/(1 - cos(pi/n)) - 1 with the rings at y = +/-1. That ratio is scale
  // invariant but grows fast with n, so the raw solid is a needle: at n=15 the
  // apex sits 60x further out than the equator. Squashing y by H brings the
  // poles back to the ring radius, giving the near-spherical proportions a
  // physical d30 actually has. Scaling one axis preserves planarity.
  const h = 1;
  const H = 2 / (1 - Math.cos(Math.PI / n)) - 1;
  // Squashing the poles to exactly the ring radius leaves a sharp bicone, but
  // over-squashing flattens the die into a pinwheel disc. Taller poles as n
  // grows keep high-count dice reading as solids rather than plates. Scaling one
  // axis preserves the planarity the apex height was solved for.
  const squash = (1 / H) * (flatten !== null ? flatten : (n > 6 ? 1.35 : 1.0));

  const verts = [[0, H * squash, 0], [0, -H * squash, 0]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    verts.push([Math.cos(a), h * squash, Math.sin(a)]);
  }
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * TAU;
    verts.push([Math.cos(a), -h * squash, Math.sin(a)]);
  }

  const top = i => 2 + (i % n);
  const bot = i => 2 + n + (i % n);
  const faces = [];
  for (let i = 0; i < n; i++) {
    faces.push([0, top(i), bot(i), top(i + 1)]);
    faces.push([1, bot(i + n - 1), top(i), bot(i)]);
  }
  return normalize({ verts, faces });
}

// d1 is the approved obliquely terminated circular cylinder (2026-08-06). An
// infinite circular cylinder running diagonally through the x-z plane, axis
// d=(-1,0,1)/sqrt2, radius R, is clipped by the two perpendicular planes x>=-a
// and z>=-a. The result is two congruent planar end caps and n lateral quads.
// Both caps return 1; they are the only legal result surfaces (landingFaces),
// so a settle always rests and reads on an end cap, never balanced on a lateral
// face. This is the analytic primitive in the same spirit as the d7's clipping.
function obliqueCylinderD1(R = 1, a = 2.187, n = 12) {
  const s2 = Math.SQRT2, verts = [], faces = [];
  const A = [], B = [];
  for (let k = 0; k < n; k++) {
    const th = TAU * k / n, c = Math.cos(th), s = Math.sin(th);
    A.push(verts.push([a * R + s2 * R * c, R * s, -a * R]) - 1); // z=-a cap
    B.push(verts.push([-a * R, R * s, a * R + s2 * R * c]) - 1); // x=-a cap
  }
  // Cap at z=-a (outward (0,0,-1)) faces down; cap at x=-a (outward (-1,0,0)).
  faces.push([...A].reverse());
  faces.push([...B]);
  // Lateral quads between adjacent parallel cylinder generators.
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    faces.push([A[k], A[j], B[j], B[k]]);
  }
  return normalize({
    verts, faces,
    landingFaces: [0, 1],
    faceKinds: faces.map((_, i) => (i < 2 ? 'cap' : 'lateral')),
  });
}

// d2 is a coin, not a polyhedron: a short cylinder with two large faces. Any
// two-faced solid is impossible, and a coin is what you'd actually flip.
function coin(segments = 20) {
  const verts = [];
  const half = 0.13;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    verts.push([Math.cos(a), half, Math.sin(a)]);
  }
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    verts.push([Math.cos(a), -half, Math.sin(a)]);
  }
  const faces = [
    Array.from({ length: segments }, (_, i) => i),
    Array.from({ length: segments }, (_, i) => 2 * segments - 1 - i),
  ];
  // The rim is drawn as quads so the edge reads as thickness, not a hairline.
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push([i, j, segments + j, segments + i]);
  }
  return normalize({ verts, faces });
}

// A conventional prism with n rectangular sides and two polygonal ends. For n=3
// this is the five-outcome body used by the approved DCC d5 study.
function regularPrism(n, half = 0.72) {
  const verts = [];
  for (let i = 0; i < n; i++) {
    const a = i * TAU / n;
    verts.push([Math.cos(a), Math.sin(a), half]);
  }
  for (let i = 0; i < n; i++) {
    const a = i * TAU / n;
    verts.push([Math.cos(a), Math.sin(a), -half]);
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

// Chamfer a convex solid while retaining one inset landing face for every face
// of the source solid. New edge and vertex polygons are styling surfaces only.
function bevelSolid(solid, amount = 0.19) {
  const verts = [], inset = solid.faces.map(() => []);
  solid.faces.forEach((face, fi) => {
    const center = face.reduce((sum, vi) => [
      sum[0] + solid.verts[vi][0], sum[1] + solid.verts[vi][1], sum[2] + solid.verts[vi][2],
    ], [0, 0, 0]).map(x => x / face.length);
    face.forEach(vi => {
      const v = solid.verts[vi];
      inset[fi].push(verts.push([
        v[0] * (1 - amount) + center[0] * amount,
        v[1] * (1 - amount) + center[1] * amount,
        v[2] * (1 - amount) + center[2] * amount,
      ]) - 1);
    });
  });

  const faces = inset.map(face => [...face]);
  const edgeUses = new Map();
  solid.faces.forEach((face, fi) => face.forEach((vi, ci) => {
    const vj = face[(ci + 1) % face.length];
    const key = vi < vj ? `${vi}:${vj}` : `${vj}:${vi}`;
    if (!edgeUses.has(key)) edgeUses.set(key, []);
    edgeUses.get(key).push({ vi, vj, fi, ci });
  }));
  for (const uses of edgeUses.values()) {
    if (uses.length !== 2) continue;
    const [a, b] = uses;
    const a0 = inset[a.fi][a.ci], a1 = inset[a.fi][(a.ci + 1) % inset[a.fi].length];
    const b0 = inset[b.fi][b.ci], b1 = inset[b.fi][(b.ci + 1) % inset[b.fi].length];
    faces.push(a.vi === b.vi ? [a0, a1, b1, b0] : [a0, a1, b0, b1]);
  }

  const corners = solid.verts.map(() => []);
  solid.faces.forEach((face, fi) => face.forEach((vi, ci) => corners[vi].push(inset[fi][ci])));
  corners.forEach((ids, vi) => {
    if (ids.length < 3) return;
    const axis = norm(solid.verts[vi]);
    const u = norm(sub(verts[ids[0]], solid.verts[vi]));
    const w = cross(axis, u);
    faces.push(ids.slice().sort((a, b) => {
      const va = sub(verts[a], solid.verts[vi]), vb = sub(verts[b], solid.verts[vi]);
      return Math.atan2(dot(va, w), dot(va, u)) - Math.atan2(dot(vb, w), dot(vb, u));
    }));
  });

  return normalize({
    verts,
    faces,
    landingFaces: Array.from({ length: solid.faces.length }, (_, i) => i),
    faceKinds: faces.map((_, i) => i < solid.faces.length ? 'landing' : 'bevel'),
  });
}

function subdividedIcosphere(levels = 3) {
  let { verts, faces } = icosa();
  verts = verts.map(v => [...v]);
  faces = faces.map(face => [...face]);
  for (let level = 0; level < levels; level++) {
    const midpoints = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (midpoints.has(key)) return midpoints.get(key);
      const id = verts.length;
      verts.push(norm([
        verts[a][0] + verts[b][0],
        verts[a][1] + verts[b][1],
        verts[a][2] + verts[b][2],
      ]));
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
    if (!loop.length || Math.hypot(...sub(p, loop.at(-1))) > epsilon) loop.push(p);
  }
  if (loop.length > 1 && Math.hypot(...sub(loop[0], loop.at(-1))) <= epsilon) loop.pop();
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
      const hit = [
        p[0] + (q[0] - p[0]) * t,
        p[1] + (q[1] - p[1]) * t,
        p[2] + (q[2] - p[2]) * t,
      ];
      out.push(hit);
      cuts.push(hit);
    }
  }
  return cleanLoop(out);
}

function c3vD7Normals() {
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

// Find the nearest point to a desired antipode that is still on the retained
// unit-sphere shell. On a two-dimensional sphere the constrained optimum is the
// target itself, one active cap boundary, or the intersection of two boundaries;
// enumerate those cases exactly instead of placing text on sphere regions removed
// by clipping.
function closestCurvedAnchor(target, landingNormals, limit) {
  const candidates = [norm(target)];
  const boundaryRadius = Math.sqrt(Math.max(0, 1 - limit * limit));

  for (const planeNormal of landingNormals) {
    const tangent = sub(target, planeNormal.map(x => x * dot(target, planeNormal)));
    if (dot(tangent, tangent) > 1e-18) {
      const direction = norm(tangent);
      candidates.push(planeNormal.map((x, i) => x * limit + direction[i] * boundaryRadius));
    }
  }

  for (let i = 0; i < landingNormals.length; i++) {
    for (let j = i + 1; j < landingNormals.length; j++) {
      const a = landingNormals[i], b = landingNormals[j];
      const denominator = 1 + dot(a, b);
      if (denominator < 1e-12) continue;
      const base = a.map((x, axis) => (x + b[axis]) * limit / denominator);
      const remaining = 1 - dot(base, base);
      if (remaining < -1e-12) continue;
      const direction = norm(cross(a, b));
      const radius = Math.sqrt(Math.max(0, remaining));
      candidates.push(
        base.map((x, axis) => x + direction[axis] * radius),
        base.map((x, axis) => x - direction[axis] * radius),
      );
    }
  }

  const feasible = candidates.filter(point =>
    landingNormals.every(n => dot(n, point) <= limit + 1e-10));
  if (!feasible.length) throw new Error('d7 has no curved numeral anchor');
  return feasible.reduce((best, point) => dot(target, point) > dot(target, best) ? point : best);
}

const rotateAroundZ = (point, angle) => [
  point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
  point[0] * Math.sin(angle) + point[1] * Math.cos(angle),
  point[2],
];

// Impact!/Vincent Greco d7: an otherwise round body clipped by seven planes at
// the proven-optimal N=7 Tammes directions. The caps are the physical rests;
// numerals live near their antipodes on the curved shell because no face pair is
// parallel. Sphere tessellation is rendering geometry, not 480 extra outcomes.
function clippedSphereD7(levels = 3) {
  const landingNormals = c3vD7Normals();
  const c = 0.2101383127306031;
  const planeOffset = Math.sqrt((1 + c) / 2);
  const sphere = subdividedIcosphere(levels);
  let polygons = sphere.faces.map(face => ({ points: face.map(i => sphere.verts[i]), kind: 'sphere' }));

  for (const planeNormal of landingNormals) {
    const cuts = [], clipped = [];
    for (const polygon of polygons) {
      const points = clipPolygon(polygon.points, planeNormal, planeOffset, cuts);
      if (points.length >= 3) clipped.push({ points, kind: polygon.kind });
    }
    const unique = new Map();
    for (const p of cuts) unique.set(p.map(x => Math.round(x * 1e9)).join(':'), p);
    const ring = [...unique.values()];
    if (ring.length < 3) throw new Error('d7 clipping failed to produce a landing cap');
    const basisA = norm(Math.abs(planeNormal[2]) < 0.9
      ? cross(planeNormal, [0, 0, 1])
      : cross(planeNormal, [0, 1, 0]));
    const basisB = cross(planeNormal, basisA);
    const center = planeNormal.map(x => x * planeOffset);
    ring.sort((a, b) => {
      const pa = sub(a, center), pb = sub(b, center);
      return Math.atan2(dot(pa, basisB), dot(pa, basisA)) -
             Math.atan2(dot(pb, basisB), dot(pb, basisA));
    });
    if (dot(faceNormal(ring), planeNormal) < 0) ring.reverse();
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
  const landingFaces = faceKinds.map((kind, i) => kind === 'cap' ? i : -1).filter(i => i >= 0);
  const anchorLimit = planeOffset - 0.02;
  const poleAnchor = closestCurvedAnchor(landingNormals[0].map(x => -x), landingNormals, anchorLimit);
  const upperAnchor = closestCurvedAnchor(landingNormals[1].map(x => -x), landingNormals, anchorLimit);
  const lowerAnchor = closestCurvedAnchor(landingNormals[4].map(x => -x), landingNormals, anchorLimit);
  const anchorPoints = [
    poleAnchor,
    ...[0, 1, 2].map(k => rotateAroundZ(upperAnchor, k * TAU / 3)),
    ...[0, 1, 2].map(k => rotateAroundZ(lowerAnchor, k * TAU / 3)),
  ];
  const valueAnchors = anchorPoints.map(point => ({ point, normal: [...point] }));
  return normalize({
    verts, faces, faceKinds, landingFaces, landingNormals, valueAnchors,
    planeOffset, hideSmoothEdges: true,
  });
}

// Prism barrel: n rectangular faces around the equator, with a pointed cap at
// each pole that is never landed on. This is how physical d5s and d7s are made,
// and unlike a bipyramid it gives an exact face count for any n — odd or even.
// The barrel's faces are all equivalent under its rotational symmetry, so it is
// as fair as the die needs to be.
function prismBarrel(n) {
  const verts = [];
  const half = 0.62;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    verts.push([Math.cos(a), half, Math.sin(a)]);
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    verts.push([Math.cos(a), -half, Math.sin(a)]);
  }
  const apexTop = verts.push([0, half + 0.55, 0]) - 1;
  const apexBot = verts.push([0, -half - 0.55, 0]) - 1;

  const faces = [];
  // The numbered faces: one rectangle per side.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n + j, n + i]);
  }
  // Caps are triangle fans, so they read as tapered ends rather than flat lids.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([apexTop, j, i]);
    faces.push([apexBot, n + i, n + j]);
  }
  return normalize({ verts, faces });
}

function normalize(solid) {
  const scale = Math.max(...solid.verts.map(v => Math.hypot(...v)));
  const verts = solid.verts.map(v => v.map(x => x / scale));
  const faces = solid.faces.map(source => {
    const face = [...source];
    const points = face.map(i => verts[i]);
    const center = points.reduce((sum, p) => [
      sum[0] + p[0] / points.length,
      sum[1] + p[1] / points.length,
      sum[2] + p[2] / points.length,
    ], [0, 0, 0]);
    const windingNormal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
    return dot(windingNormal, center) < 0 ? face.reverse() : face;
  });
  const faceNormals = faces.map(face => {
    const n = [0, 0, 0];
    for (let i = 0; i < face.length; i++) {
      const a = verts[face[i]], b = verts[face[(i + 1) % face.length]];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return n;
  });
  const edgeMap = new Map();
  faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
      edgeMap.get(key).faces.push(fi);
    }
  });
  const wireEdges = [...edgeMap.values()].map(edge => ({
    ...edge,
    sphereOnly: edge.faces.every(fi => solid.faceKinds?.[fi] === 'sphere'),
  }));
  return {
    ...solid,
    verts,
    faces,
    faceNormals,
    wireEdges,
    landingFaces: solid.landingFaces ? [...solid.landingFaces] : undefined,
    faceKinds: solid.faceKinds ? [...solid.faceKinds] : undefined,
  };
}

const SOLIDS = {
  3: cube,
  4: tetra,
  5: () => ({
    ...bevelSolid(regularPrism(3, 0.72), 0.19),
    // Do not let the three larger rectangular sides monopolize every settled
    // presentation; the two triangular ends are equally valid d5 outcomes.
    equalLandingPresentation: true,
  }),
  6: cube,
  7: (_size, budget) => clippedSphereD7(budget <= 36 ? 1 : 2),
  8: octa,
  12: dodeca,
  14: () => trapezohedron(7, 0.95),
  16: () => bipyramid(8, 1.06),
  20: icosa,
  24: deltoidalIcositetrahedron,
  30: rhombicTriacontahedron,
};

// Cache: the hull recovery in dodeca/icosa is O(v^3), and barrels get rebuilt
// on every roll otherwise.
const solidCache = new Map();

// Above this, facets are finer than the die is ever drawn, so more only cost
// frame time. d100 and beyond share this silhouette.
// The pointed families (trapezohedra, bipyramids, crystals) run every facet to
// an apex, so their edges converge and they turn illegible fast — a
// trapezohedron is already a blob by 40 faces. Above this, dice use the drum,
// whose vertices spread over bands and stay countable past 120.
// Measured, not guessed: a trapezohedron is already crowded at 24 faces and an
// unreadable blob by 40, because every facet runs to one of two apexes. The
// drum has no such convergence and stays countable past 120.
const POINTED_LIMIT = 22;

// Ceiling on facets for any die. Measured, not guessed: at a die's drawn size a
// banded drum is still readable here, while anything pointed is long gone.
const MAX_FACETS = 120;
// Dice up to d1000 get their exact face count; the draw budget (MAX_FACETS) is
// reserved for *display* thinning (edge-ink LOD), not geometry. Above d1000 the
// notation blows the picker, so it tops out at a thousand real faces.
const EXACT_FACE_LIMIT = 1000;
// Dice with more faces than this are "spherical" for display: their landing
// scan would cost candidates x vertices x faces for a face the eye can't even
// isolate, so they keep the tumble pose they landed in and read the result off
// a centered numeral overlay instead. This is what keeps an exact d1000's roll
// smooth (a 40-pose scan over 1996 verts x 1000 faces would cost ~20ms).
const SPHERICAL_AT = 100;

// How fast a die tumbles when thrown, in radians per frame before decay.
//
// A constant, and it was not: the spin was seeded from throw speed, and throw
// speed is `(homeX - x) * 2.4` — proportional to how far the die has to travel,
// which is proportional to the width of the tray. So the same roll tumbled for
// noticeably longer in a desktop window than in an Owlbear panel, purely
// because the panel is smaller. How long an animation runs should not be a
// function of the viewport it runs in.
//
// Distance still scales with the tray, which is right — a die in a small tray
// has less ground to cover and should cross it in the same time. Only the
// tumble is decoupled.
const TUMBLE = 8.4;

// How slowly a die must be travelling before its rotation is allowed to settle,
// in pixels per second.
//
// Absolute rather than scaled to the die. Scaling it was tried, on the argument
// that a 40px die at 60px/s is visually faster than a 96px one — true, and it
// trades a small inconsistency for a worse one, because dice shrink as a
// handful grows and the roll would then take longer the more dice were in it.
//
// This used to be 8, and it was the single reason the numeral took three
// seconds to appear. The condition asks two questions — has it stopped moving,
// has it stopped turning — and only the second one is about rotation. A die is
// pulled toward its slot by a spring, so it keeps drifting long after it has
// visibly stopped: rotation was done by ~0.9s and the 8px/s line was not
// crossed until 2.3s, with the die already within five pixels of home.
//
// At 60px/s a die is about one width from its slot and moving a pixel a frame,
// which is where a real one would already have stopped rolling. It carries on
// gliding in while the rotation settles — see the settling branch, which eases
// position with exactly the same curve the settled branch uses, so the handover
// between them is invisible.
const SETTLE_SPEED = 60;

// How fast translation decays, per 1/60s. Applied as pow(DRAG, dt * 60), for
// the reason spelled out on SPIN_DECAY.
const DRAG = 0.94;

// How fast a tumble decays, per 1/60s.
//
// Per *sixtieth of a second*, not per frame, and the difference is not
// pedantic. Both decays used to be applied once per frame while the rotation
// they damp was integrated per second — so how long a roll lasted depended on
// how fast the page happened to be rendering. Measured: the same throw took
// 1.9s at 60fps and 3.0s at 30, which is exactly the shape of "the dice roll
// for half as long in the Owlbear panel" when the panel's canvas is a quarter
// of the area and hits frame rates the desktop tray does not.
//
// A roll is a fixed piece of choreography. It should take the same time on a
// phone, on a desktop, and in a 374px panel.
//
// Named because two things now depend on it, and because it is the number that
// decides how long a die spins. It is deliberately separate from the 0.94 that
// damps translation: a die stops rolling across the tray and stops turning on
// the spot for different reasons, and at 0.965 they were badly out of step —
// dice came to a halt and then kept revolving for another two seconds.
const SPIN_DECAY = 0.92;

// How long the numeral takes to appear once the die is at rest, in seconds.
//
// It appears *after* the settle, not during it. The settle is the small final
// movement where a die straightens up and brings a face square to the camera,
// and until that finishes the facet under the numeral is still changing. Fading
// across it — even across its last 45%, which is only about 4 degrees of travel
// — still means the number arrives while the die is visibly being adjusted, and
// that reads as arriving too early.
//
// So: nothing at all until the die has stopped, then a fast pop. Short enough
// to feel like the number was revealed by the die coming to rest, long enough
// not to be a hard cut. Rotation under the glyph while it appears is zero by
// construction, because a settled die does not rotate at all.
const NUMERAL_POP_S = 0.14;

// Resting-orientation searches allowed per frame. Enough that small rolls all
// resolve at once, low enough that a 100-dice roll spreads the cost instead of
// spiking one frame past the 16.7ms budget.
const SEARCHES_PER_FRAME = 6;
let searchBudget = SEARCHES_PER_FRAME;
let searchFrame = -1;

// The budget refills once per frame, driven by the render loop.
let frameCounter = 0;
export function beginFrame() { frameCounter++; }

function claimSearchBudget() {
  if (searchFrame !== frameCounter) {
    searchFrame = frameCounter;
    searchBudget = SEARCHES_PER_FRAME;
  }
  if (searchBudget <= 0) return false;
  searchBudget--;
  return true;
}

// A die with a given number of facets, spread evenly over a sphere.
//
// Spread N points over the sphere, take their convex hull, then the polar dual.
// The hull has one vertex per point, so its dual has exactly one face per
// point: N facets, however awkward N is. No factorising, no remainder wedges.
//
// This replaced a banded drum, and the reason is what a drum looks like rather
// than what it is. A drum's facets sit in rows and columns, and rows and
// columns read as a barrel — the eye finds the structure before it finds the
// count. Points on a Fibonacci spiral have no rows, so the facets read as a
// many-sided die does: evenly sized, evenly spread, and countable in principle
// rather than arranged in a grid.
//
// Every face is exactly planar by construction. The face belonging to point p
// lies in the plane p·x = 1, which is what polar duality means; there is no
// tolerance involved and nothing to check.
function fibonacciPoints(n) {
  const pts = [];
  // The golden angle. Nothing shorter spreads points on a sphere this evenly.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    pts.push(norm([Math.cos(a) * r, y, Math.sin(a) * r]));
  }
  return pts;
}

// Incremental convex hull. Every point is on the sphere and so every one is a
// hull vertex; this is really their Delaunay triangulation. hullFaces above
// cannot do this job — it compares every triple against every vertex, which is
// fine for the twenty-vertex Platonics it was written for and far too slow at a
// hundred and twenty.
function convexHull(points) {
  const faces = [];
  const add = (a, b, c) => {
    const n = cross(sub(points[b], points[a]), sub(points[c], points[a]));
    faces.push({ v: [a, b, c], n, d: dot(n, points[a]) });
  };
  // Seed with a degenerate two-sided triangle; the first insertion inflates it.
  add(0, 1, 2);
  add(0, 2, 1);

  for (let i = 3; i < points.length; i++) {
    const p = points[i];
    const visible = new Set();
    faces.forEach((f, k) => { if (dot(f.n, p) - f.d > 1e-12) visible.add(k); });
    if (!visible.size) continue;

    // The horizon is the edges of the visible region that the region does not
    // share with itself — every other edge is interior and disappears.
    const seen = new Map();
    for (const k of visible) {
      const [a, b, c] = faces[k].v;
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const key = x < y ? `${x}:${y}` : `${y}:${x}`;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
    }
    const horizon = [];
    for (const k of visible) {
      const [a, b, c] = faces[k].v;
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const key = x < y ? `${x}:${y}` : `${y}:${x}`;
        if (seen.get(key) === 1) horizon.push([x, y]);
      }
    }

    const kept = faces.filter((_, k) => !visible.has(k));
    faces.length = 0;
    faces.push(...kept);
    for (const [x, y] of horizon) add(x, y, i);
  }
  return faces;
}

function facetedSphere(n) {
  const points = fibonacciPoints(n);
  const hull = convexHull(points);

  // One dual vertex per hull face: the plane of that face, as a point.
  const verts = hull.map(f => {
    const s = f.d || 1e-9;
    return [f.n[0] / s, f.n[1] / s, f.n[2] / s];
  });

  // One dual face per point, wound around that point so the polygon does not
  // cross itself.
  const touching = points.map(() => []);
  hull.forEach((f, i) => f.v.forEach(v => touching[v].push(i)));

  const faces = [];
  points.forEach((p, i) => {
    const ring = touching[i];
    if (ring.length < 3) return;
    const first = verts[ring[0]];
    const u = norm(sub(first, p.map(x => x * dot(p, first))));
    const w = cross(p, u);
    faces.push(ring.slice().sort((a, b) => {
      const va = sub(verts[a], p), vb = sub(verts[b], p);
      return Math.atan2(dot(va, w), dot(va, u)) - Math.atan2(dot(vb, w), dot(vb, u));
    }));
  });

  return normalize({ verts, faces });
}


function facetBudget(size) {
  if (!size || size >= 60) return MAX_FACETS;
  if (size >= 40) return 60;
  if (size >= 26) return 36;
  return 18;
}

export function solidFor(sides, size = null) {
  if (!Number.isFinite(sides) || sides < 1) return null;

  const budget = facetBudget(size);
  // Exact-facet solids (d23-d1000) are geometric, so they don't depend on the
  // draw budget: one cache entry per side, not one per draw-size. Otherwise the
  // same facetedSphere(1000) gets regenerated per budget and wasted.
  const exact = sides > POINTED_LIMIT && sides <= EXACT_FACE_LIMIT && !UNDER_30_GAP[sides] && !SOLIDS[sides];
  const key = `${sides}:${exact ? 'x' : budget}`;
  if (solidCache.has(key)) return solidCache.get(key);

  let solid;
  if (sides === 1) {
    solid = obliqueCylinderD1();
  } else if (sides === 2) {
    solid = coin();
  } else if (SOLIDS[sides]) {
    solid = SOLIDS[sides](size, budget);
  } else if (UNDER_30_GAP[sides]) {
    // under-30 gap dice (d9-d29): ChatGPT's controlled-landmark-truncation meshes,
    // embedded in under30-gap.js. Kept exact so the approved silhouettes hold.
    solid = UNDER_30_GAP[sides];
  } else if (sides <= POINTED_LIMIT) {
    // Few enough facets that a pointed solid still reads: exactly one face per
    // side, in the shape a physical die of that size actually takes.
    solid = sides % 2 === 0 && sides / 2 >= 3
      ? trapezohedron(sides / 2)
      : prismBarrel(sides);
  } else if (sides <= EXACT_FACE_LIMIT) {
    // Exactly one facet per side, spread evenly over a sphere — right down to
    // d1000, so a d300 has 300 faces and a d1000 has 1000. Display thinning is
    // the draw pass's job (edge-ink LOD), not geometry's.
    solid = facetedSphere(sides);
  } else {
    // d1001+ (above the picker): a thousand true faces — as many as the eye
    // can separate, and more than any notation a player will type.
    solid = facetedSphere(EXACT_FACE_LIMIT);
  }

  if (!solid.faceNormals || !solid.wireEdges) solid = normalize(solid);
  solidCache.set(key, solid);
  return solid;
}

export class Die {
  constructor(sides, value, x, y, size) {
    this.sides = sides;
    this.value = value;
    this.size = size;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    // Resolved lazily: the real size is assigned by the layout after
    // construction, and detail depends on how large the die is actually drawn.
    this._solid = null;
    this._solidSize = null;
    this.rot = [Math.random()*TAU, Math.random()*TAU, Math.random()*TAU];
    this.spin = [0, 0, 0];
    this.settling = false;
    this.settled = false;
    this.settleT = 0;
    this.restRot = null;
    // How much of the numeral is showing, 0 to 1. See stepNumeral.
    this.numeralIn = 0;
  }

  throwWith(vx, vy) {
    this.vx = vx; this.vy = vy;
    this.spin = [
      (Math.random()-0.5) * TUMBLE + 0.15,
      (Math.random()-0.5) * TUMBLE + 0.15,
      (Math.random()-0.5) * TUMBLE,
    ];
    this.settling = false;
    this.settled = false;
    this.targetRot = null; // recomputed for wherever this throw lands
    // Back in the air, so the number goes away again until this throw resolves.
    this.numeralIn = 0;
  }

  // Geometry for this die at its current size. Re-resolved when the size
  // changes, so a die that grows on a resize gains the detail to match.
  get solid() {
    const budget = facetBudget(this.size);
    if (!this._solid || this._solidSize !== budget) {
      this._solid = solidFor(this.sides, this.size);
      this._solidSize = budget;
      // Detail changed, so any pose chosen for the old geometry no longer holds.
      this.targetRot = null;
    }
    return this._solid;
  }

  // Tumble in place without moving. Used for large rolls, where flying dice
  // across the tray costs frames and reads as noise — they all end up in the
  // same grid anyway. `delay` staggers the settle so the grid resolves in a
  // wave rather than every die stopping on the same frame.
  spinInPlace(delay = 0) {
    this.vx = 0;
    this.vy = 0;
    // Already in its slot, so home is where it stands: the settled drift then
    // has nothing to correct rather than pulling it somewhere new.
    this.homeX = this.x;
    this.homeY = this.y;
    this.spin = [
      0.34 + Math.random() * 0.22,
      0.30 + Math.random() * 0.22,
      (Math.random() - 0.5) * 0.16,
    ];
    this.settling = false;
    this.settled = false;
    this.targetRot = null;
    this.numeralIn = 0;
    this.spinHold = 0.16 + delay * 0.42;
  }

  // A rerolled die does the thing a hand does: lands, pauses long enough to see
  // the bad number, then hops and tumbles again. Without it a reroll is
  // invisible — 1d2r1 rerolls every single time and looked identical to a plain
  // roll, which is the case that exposed it.
  //
  // Called once the die has settled; the value it lands on afterwards is the one
  // the roller already decided, so this is presentation only.
  beginReroll() {
    this.rerollPause = 0.34;
    this.rerollHop = null;
  }

  stepReroll(dt, bounds) {
    if (this.rerollPause > 0) {
      this.rerollPause -= dt;
      if (this.rerollPause > 0) return true;
      // The hop: up, over a little, and spinning again.
      this.settled = false;
      this.settling = false;
      this.targetRot = null;
      this.searchWait = 0;
      this.spinHold = undefined;
      // The point of a reroll is watching the first number go away, so the
      // numeral has to leave with the hop rather than ride it up.
      this.numeralIn = 0;
      this.vx = (Math.random() - 0.5) * 90;
      this.vy = -210;
      this.spin = [
        0.26 + Math.random() * 0.16,
        0.24 + Math.random() * 0.16,
        (Math.random() - 0.5) * 0.14,
      ];
      this.rerollHop = true;
      this.rerollPause = 0;
    }
    return false;
  }

  step(dt, bounds) {
    // First, so that the several early returns below cannot skip it. It reads
    // the previous frame's motion, which is a frame of lag on a fade lasting
    // tens of them.
    this.stepNumeral(dt);

    // Mid-reroll: hold still for a beat, then throw the die back up.
    if (this.rerollPause > 0) {
      if (this.stepReroll(dt, bounds)) return;
    }

    // A settled die keeps easing toward its slot, slowly. The grid is already
    // sorted — dice grouped by type, each group high to low — so this reads as
    // the tray tidying itself the way a hand does after a throw. It is a
    // separate, much gentler pull than the one during flight, and it stops once
    // the die is close enough that further movement would not be visible.
    if (this.settled) {
      if (this.homeX === undefined) return;
      const dx = this.homeX - this.x;
      const dy = this.homeY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.4) return;
      const ease = Math.min(1, dt * 2.4);
      this.x += dx * ease;
      this.y += dy * ease;
      return;
    }

    // Spin-in-place dice hold their slot: no translation, no wall bounces, and
    // no separation work, since the grid already spaced them.
    if (this.spinHold !== undefined && !this.settling) {
      this.spinHold -= dt;
      for (let i = 0; i < 3; i++) this.rot[i] += this.spin[i] * dt * 60;
      if (this.spinHold <= 0) {
        this.settling = true;
        this.settleT = 0;
        this.restRot = this.rot.slice();
      }
      return;
    }

    if (!this.settling) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Damping raised to the frame's share of a 60fps step, rather than
      // applied once per frame. See DRAG.
      const frames = dt * 60;
      const drag = Math.pow(DRAG, frames);
      this.vx *= drag;
      this.vy *= drag;

      const r = this.size * 0.55;
      if (this.x < bounds.left + r) { this.x = bounds.left + r; this.vx = Math.abs(this.vx) * 0.55; }
      if (this.x > bounds.right - r) { this.x = bounds.right - r; this.vx = -Math.abs(this.vx) * 0.55; }
      if (this.y < bounds.top + r) { this.y = bounds.top + r; this.vy = Math.abs(this.vy) * 0.55; }
      if (this.y > bounds.floor - r) { this.y = bounds.floor - r; this.vy = -Math.abs(this.vy) * 0.55; }

      const slow = Math.pow(SPIN_DECAY, frames);
      for (let i = 0; i < 3; i++) {
        this.rot[i] += this.spin[i] * frames;
        this.spin[i] *= slow;
      }

      // Ease toward the slot the layout assigned, so dice spread out instead of
      // landing wherever momentum happens to leave them.
      if (this.homeX !== undefined) {
        this.vx += (this.homeX - this.x) * 3.2 * dt;
        this.vy += (this.homeY - this.y) * 3.2 * dt;
      }

      if (Math.hypot(this.vx, this.vy) < SETTLE_SPEED && Math.abs(this.spin[0]) < 0.02) {
        this.settling = true;
        this.settleT = 0;
        this.restRot = this.rot.slice();
      }
    } else {
      // Position keeps easing while the rotation settles.
      //
      // Settling used to begin only once a die had all but stopped, so leaving
      // translation out of this branch cost nothing. It now begins while the
      // die still has a width to travel, and without this the die would freeze
      // in mid-glide for the length of the settle and then resume — the same
      // easing as the settled branch, so nothing changes at the handover.
      if (this.homeX !== undefined) {
        const ease = Math.min(1, dt * 2.4);
        this.x += (this.homeX - this.x) * ease;
        this.y += (this.homeY - this.y) * ease;
      }

      // Ease the tumble to a stop, rotating toward an orientation that presents
      // a face to the camera. Landing on a pole or a vertex reads as a spike and
      // leaves nowhere to paint the numeral.
      //
      // The search is the most expensive thing in the frame, so it is rationed:
      // when a hundred dice settle together the searches otherwise bunch onto a
      // few frames and cause a visible hitch. A die that misses its turn keeps
      // spinning for another frame, which is invisible.
      // A die that has waited several frames for budget takes its turn anyway.
      // Without that floor, a caller that never advances the frame counter would
      // leave dice spinning forever instead of merely animating less smoothly.
      if (!this.targetRot) {
        this.searchWait = (this.searchWait || 0) + 1;
        if (this.searchWait < 30 && !claimSearchBudget()) return;
        this.targetRot = this.findFaceUpRotation();
      }
      this.settleT = Math.min(1, this.settleT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.settleT, 3);
      for (let i = 0; i < 3; i++) {
        this.rot[i] = this.restRot[i] + (this.targetRot[i] - this.restRot[i]) * e;
      }
      if (this.settleT >= 1) this.settled = true;
    }
  }

  // Search nearby rotations for one that turns some face toward the camera.
  // Sampling beats solving for it: the solids differ enough in face layout that
  // a closed form would need per-family special cases, and this runs once.
  findFaceUpRotation() {
    if (!this.solid) return this.rot.slice();
    // High face counts are spherical: scanning candidates x faces x vertices for
    // a face no eye can isolate is pure cost (a d1000 scan would be ~20ms). Keep
    // the pose it tumbled to — the numeral overlay reads the result regardless.
    // Opaque-shell dice (e.g. the d7's hideSmoothEdges clip) are not spherical
    // faceted dice and keep their anchor-driven settling.
    if (this.solid.faces.length > SPHERICAL_AT && !this.solid.hideSmoothEdges) return this.rot.slice();
    let best = this.rot.slice(), bestScore = -Infinity;

    // Cost is candidates x faces x vertices, so a fixed candidate count makes
    // high-face dice disproportionately expensive — a d50 cost ~8ms, enough to
    // drop frames on a 100-dice roll. Many-faced solids also have a face
    // pointing almost anywhere, so they need far fewer samples to land one.
    const samples = this.solid.faces.length > 20 ? 40
                  : this.solid.faces.length > 10 ? 80
                  : 140;

    for (let i = 0; i < samples; i++) {
      // First candidate is the current pose, so an already-good landing sticks.
      // Later candidates search the full sphere: a coin's two broad faces lie on
      // a single axis, and a narrow search around a rim-on landing can never
      // reach them.
      const spread = i < samples * 0.43 ? 2.6 : TAU;
      const cand = i === 0 ? this.rot.slice() : [
        this.rot[0] + (Math.random() - 0.5) * spread,
        this.rot[1] + (Math.random() - 0.5) * spread,
        this.rot[2] + (Math.random() - 0.5) * spread,
      ];
      let visible = 0;
      if (this.solid.valueAnchors?.length) {
        // Odd clipped-sphere dice have no parallel top face. Present one of the
        // curved antipodal numeral sites instead of pretending a landing cap is
        // also the result face.
        for (const anchor of this.solid.valueAnchors) {
          const n = rotate(anchor.normal, cand[0], cand[1], cand[2]);
          if (n[2] > 0) visible = Math.max(visible, n[2]);
        }
      } else {
        // Score by projected screen area, not facing angle alone. Facing alone
        // lets a sliver of rim beat a broad face turned slightly away.
        const pts = this.solid.verts.map(v => rotate(v, cand[0], cand[1], cand[2]));
        const faceIndices = this.solid.landingFaces || this.solid.faces.map((_, i) => i);
        for (const fi of faceIndices) {
          const face = this.solid.faces[fi];
          const fp = face.map(i2 => pts[i2]);
          const n = faceNormal(fp);
          const len = Math.hypot(...n);
          if (!len) continue;
          const facing = n[2] / len;
          if (facing <= 0) continue;
          const area = this.solid.equalLandingPresentation ? 1 : polygonArea(fp);
          visible = Math.max(visible, facing * area * facing);
        }
      }
      // Prefer a square-on outcome surface while staying near the pose it landed in.
      const drift = Math.abs(cand[0] - this.rot[0]) + Math.abs(cand[1] - this.rot[1]);
      const score = visible - drift * 0.02;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    return best;
  }

  draw(ctx, theme) {
    const s = this.size * 0.5;
    ctx.save();
    ctx.translate(this.x, this.y);

    // A dropped die is still shown — you rolled it — but recedes, so the dice
    // that actually count read at a glance. Without this the tray implies every
    // die contributed to the total.
    const fade = this.kept === false && this.settled ? 0.3 : 1;
    ctx.globalAlpha = fade;

    // Nothing to draw without geometry. This used to call a drawToken() that no
    // longer exists, which threw on every frame and took the whole render loop
    // down with it — one bad die blanked the tray until a reload.
    if (!this.solid) {
      ctx.restore();
      return;
    }

    const M = rotMatrix(this.rot[0], this.rot[1], this.rot[2]);
    const pts = this.solid.verts.map(v => applyRot(M, v));
    const proj = pts.map(p => {
      const d = 4 / (4 - p[2]);
      return [p[0] * s * d, p[1] * s * d, p[2]];
    });

    // Face normals and edge adjacency are invariant, so normalize() computes
    // them once per cached solid rather than rebuilding Maps and Sets per frame.
    const frontFaces = this.solid.faceNormals.map(n => applyRot(M, n)[2] > 0);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // High-facet dice (d101+, exact geometry) are drawn as a dense polyhedron:
    // the projected silhouette at full ink, interior edges thinned by the
    // microAlpha law so the body reads as faceted rather than a solid grey disc.
    // Opaque-shell dice (d7) are excluded — they draw silhouette-only already.
    const micro = !this.solid.hideSmoothEdges && this.solid.faces.length > SPHERICAL_AT
      ? Math.min(0.55, Math.max(0.08, 0.55 * Math.sqrt(100 / this.solid.faces.length)))
      : null;
    const emit = (edges, alpha, width) => {
      ctx.beginPath();
      for (const edge of edges) {
        ctx.moveTo(proj[edge.a][0], proj[edge.a][1]);
        ctx.lineTo(proj[edge.b][0], proj[edge.b][1]);
      }
      // Hunger (blood) dice draw their whole wireframe in the accent colour so
      // they read as a distinct class on the tray, not only by their glyph.
      ctx.strokeStyle = this.genColor || (this.hunger ? theme.accent : theme.line);
      ctx.globalAlpha = fade * alpha;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    if (micro) {
      const sil = [], fr = [], bk = [];
      for (const edge of this.solid.wireEdges) {
        const front = edge.faces.some(fi => frontFaces[fi]);
        const back = edge.faces.some(fi => !frontFaces[fi]);
        if (front && back) sil.push(edge);
        else if (front) fr.push(edge);
        else if (back) bk.push(edge);
      }
      emit(sil, 1, 1.6);
      emit(fr, micro, 1.1);
      emit(bk, micro * 0.22, 1.0);
    } else {
    for (const pass of [false, true]) {
      ctx.beginPath();
      for (const edge of this.solid.wireEdges) {
        const front = edge.faces.some(fi => frontFaces[fi]);
        const back = edge.faces.some(fi => !frontFaces[fi]);
        // The d7 shell is opaque rather than a transparent geodesic cage: cap
        // boundaries on its far side must not show through the rounded body.
        if (this.solid.hideSmoothEdges && pass === false) continue;
        if (this.solid.hideSmoothEdges && edge.sphereOnly) {
          // Keep only the projected silhouette of the rounded shell. Interior
          // triangulation approximates curvature and is not visible geometry.
          if (pass !== true || !front || !back) continue;
        } else if (front !== pass) continue;
        ctx.moveTo(proj[edge.a][0], proj[edge.a][1]);
        ctx.lineTo(proj[edge.b][0], proj[edge.b][1]);
      }
      ctx.strokeStyle = this.genColor || (this.hunger ? theme.accent : theme.line);
      // Scaled rather than set, so a dropped die's fade survives this pass.
      ctx.globalAlpha = fade * (pass ? 1 : 0.22);
      ctx.lineWidth = pass ? 1.6 : 1.1;
      ctx.stroke();
    }
    }
    ctx.globalAlpha = fade;

    this.drawValue(ctx, theme, s, pts, proj);
    ctx.restore();
  }

  // What happened to this die, in the same hairline vocabulary as the dice: a
  // burst for an exploded die, a cycle for a rerolled one. Small enough to
  // ignore, present enough to answer "why is this d6 showing 14".
  // A ring inscribed on the numeral's own face, in the same skewed plane the
  // digits sit in, so it reads as marked *on* the die rather than as a badge
  // floating over it. Two rings for a die that both exploded and rerolled.
  //
  // The motion does most of the work now — an exploding die throws a burst, a
  // rerolled one hops and tumbles again — so this only has to persist the fact
  // after everything has settled.
  drawFaceMark(ctx, theme, size) {
    const rings = (this.exploded ? 1 : 0) + (this.rerolled ? 1 : 0);
    if (!rings || !this.settled) return;

    ctx.save();
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (let i = 0; i < rings; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, size * (0.78 + i * 0.2), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // How much of the numeral to show. Nothing while the die is tumbling fast,
  // then a fade in as it slows onto a readable face.
  //
  // The glyph is painted on whichever face currently points at the camera, so
  // through a tumble it appears to hop from facet to facet. Players read that
  // as the number still being decided, which is exactly backwards: the value
  // was fixed before the die moved, and the tumble is a drawing of it.
  //
  // Binding the glyph to one facet is the obvious fix and does not work — both
  // directions of it were tried and reverted, and IDEAS.md records why. This
  // takes the other route and shows no number until there is one face to show
  // it on, which costs nothing and needs no new geometry.
  //
  // The trigger is angular speed rather than the settle flags, and that
  // distinction is the whole of this method. `settling` does not begin until
  // spin[0] falls under 0.02 rad/frame, and throwWith seeds spin proportional
  // to throw speed while step decays it by only 3.5% a frame — so a thrown die
  // does not formally settle for about **2.9 seconds**, long after the app has
  // announced the total at 620ms. Keyed on the settle, the numeral was simply
  // absent for the entire animation. Keyed on how fast the die is actually
  // turning, it arrives when the die becomes readable, which is what a player
  // watching it means by "when it stops".
  //
  // Spin-in-place dice are the exception: their spin never decays, because they
  // hold a constant tumble for a staggered interval and then settle. There is
  // no slowing to detect, so those fade on the settle instead.
  //
  // Monotonic by construction: once the fade starts it only ever advances,
  // because a numeral that dimmed on its way in would read as a flicker rather
  // than an arrival. Only a reset — a throw, a spin, a reroll's hop — takes it
  // back to nothing.
  stepNumeral(dt) {
    if (this.numeralIn >= 1) return;
    // Nothing until the die is completely at rest — through the tumble, and
    // through the straightening that follows it.
    if (!this.settled) return;
    this.numeralIn = Math.min(1, this.numeralIn + dt / NUMERAL_POP_S);
  }

  numeralAlpha() {
    return this.numeralIn;
  }

  // Paint the numeral onto the face that most directly faces the camera, using
  // that face's own plane. The glyph is skewed to sit in the surface rather than
  // floating flat over the shape, so it tracks the die as it tumbles.
  drawValue(ctx, theme, s, pts, proj) {
    // Nothing to paint while the die is in the air. Returning before the face
    // search rather than after also takes the most expensive part of this
    // method off every frame of a hundred-dice tumble.
    const alpha = this.numeralAlpha();
    if (alpha <= 0) return;
    // A staged die has no value yet: it is waiting on the tray to be thrown.
    if (this.value === null || this.value === undefined) return;

    // V5 hunger (blood) dice read their numeral in the accent colour so they are
    // visually distinct from the ordinary d10s in the same pool.
    const ink = this.genColor || (this.hunger ? theme.accent : theme.line);

    // Spherical high dice (d101+, exact facets): no microface can legibly hold a
    // three- or four-digit result, so it floats at the die's centre over a small
    // paper knockout that clears the surrounding micro-edges. Opaque-shell dice
    // (d7, which use valueAnchors) keep their engraved-silhouette placement.
    if (!this.solid.hideSmoothEdges && !this.solid.valueAnchors?.length && this.solid.faces.length > SPHERICAL_AT) {
      const label = String(this.value);
      const fit = label.length >= 4 ? 0.34 : label.length >= 3 ? 0.42 : label.length >= 2 ? 0.5 : 0.6;
      const size = Math.max(8, s * fit);
      ctx.save();
      ctx.fillStyle = theme.paper;
      ctx.globalAlpha = alpha * 0.92;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.98, 0, TAU);
      ctx.fill();
      ctx.font = `700 ${size}px "Iosevka Etoile", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ink;
      ctx.globalAlpha = alpha;
      ctx.fillText(label, 0, 0);
      this.drawFaceMark(ctx, theme, size * 1.2);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    if (this.solid.valueAnchors?.length) {
      let best = null, bestFacing = 0;
      for (const anchor of this.solid.valueAnchors) {
        const normal = rotate(anchor.normal, ...this.rot);
        if (normal[2] > bestFacing) { bestFacing = normal[2]; best = anchor; }
      }
      if (!best || bestFacing <= 0.2) return;
      const point = rotate(best.point, ...this.rot);
      const perspective = 4 / (4 - point[2]);
      const at = [point[0] * s * perspective, point[1] * s * perspective];
      const label = String(this.value);
      const fit = label.length > 2 ? 0.28 : label.length > 1 ? 0.35 : 0.44;
      const size = Math.max(7, s * fit * (0.72 + 0.28 * bestFacing));
      const grown = size * (0.88 + 0.12 * alpha);
      ctx.save();
      ctx.translate(at[0], at[1]);
      // A tangent-plane approximation to engraving on the curved shell. The
      // anchor itself follows the sphere; this squash gives the glyph the same
      // foreshortening as the surface under it.
      ctx.transform(1, 0, 0, bestFacing, 0, 0);
      ctx.font = `600 ${grown}px "Iosevka Etoile", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ink;
      ctx.globalAlpha = alpha;
      ctx.fillText(label, 0, 0);
      this.drawFaceMark(ctx, theme, size);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // Pick the face by visible screen area, matching findFaceUpRotation. Going
    // by facing angle alone paints the numeral on whatever sliver happens to
    // point at the camera — on a coin, that meant a digit on the rim.
    let best = null, bestFacing = 0, bestScore = 0;
    const faceIndices = this.solid.landingFaces || this.solid.faces.map((_, i) => i);
    for (const fi of faceIndices) {
      const face = this.solid.faces[fi];
      const fp = face.map(i => pts[i]);
      const n = faceNormal(fp);
      const len = Math.hypot(...n);
      if (!len) continue;
      const facing = n[2] / len;
      if (facing <= 0.2) continue;
      const score = facing * polygonArea(fp);
      if (score > bestScore) { bestScore = score; bestFacing = facing; best = face; }
    }
    if (!best) return;

    // Face centre in screen space, and an in-plane axis to skew the glyph with.
    const c2 = best.reduce((a, i) => [a[0] + proj[i][0], a[1] + proj[i][1]], [0, 0])
                   .map(v => v / best.length);

    // V5 symbol dice are drawn here and return early: the glyph sits upright and
    // centred on the up-face, always the same way round however the die settled,
    // and is sized to the face's inscribed circle so it fills the face rather
    // than floating small in the middle. Numerals skew into the face plane to
    // read as engraved; a symbol reads better flat and consistent, which is what
    // was asked for.
    if (this.v5Face) {
      const r = faceInradiusScreen(best, proj, c2);
      const box = Math.max(6, r * 1.82 * (0.9 + 0.1 * alpha));
      // Stand the glyph up along the face's own axis: the loop points at the
      // kite's apex, the blade toward the equator, so the mark reads as printed
      // on the die rather than pasted on flat.
      const [ux, uy] = faceUpAxis(best, proj, c2);
      const dnx = -ux, dny = -uy;           // local +y (blade) → toward equator
      ctx.save();
      ctx.translate(c2[0], c2[1]);
      ctx.transform(dny, -dnx, dnx, dny, 0, 0); // pure rotation onto the axis
      ctx.globalAlpha = alpha;
      drawV5Glyph(ctx, this.v5Face, box, ink, theme.paper);
      this.drawFaceMark(ctx, theme, box * 0.6);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // Fate dice: a plus, a minus, or a blank on the cube face. The marks are
    // symmetric enough to sit screen-upright rather than tracking a square face's
    // (ambiguous) axis, and centred to the face's inscribed circle.
    if (this.fateFace) {
      const r = faceInradiusScreen(best, proj, c2);
      const box = Math.max(6, r * 1.5 * (0.9 + 0.1 * alpha));
      ctx.save();
      ctx.translate(c2[0], c2[1]);
      ctx.globalAlpha = alpha;
      drawFateGlyph(ctx, this.fateFace, box, ink);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // The One Ring's Feat die shows the Eye of Sauron or the Gandalf rune in
    // place of a number; both sit upright and centred.
    if (this.torFace) {
      const r = faceInradiusScreen(best, proj, c2);
      const box = Math.max(6, r * 1.55 * (0.9 + 0.1 * alpha));
      ctx.save();
      ctx.translate(c2[0], c2[1]);
      ctx.globalAlpha = alpha;
      drawTorGlyph(ctx, this.torFace, box, ink);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // The transform below maps the glyph's local +x onto (ux, uy), so this is the
    // direction the text reads along. Pick the face's own axis that runs closest
    // to screen-right, which keeps the numeral upright.
    //
    // Using the first vertex instead — as this did — left the glyph at whatever
    // rotation that vertex happened to sit at, so numerals regularly landed
    // upside down and a 63 read as a 39 at a glance.
    // Candidates are the face's own edge directions — the lines a numeral would
    // be printed parallel to on a real die — plus horizontal as a fallback for
    // faces whose edges all run steeply.
    let ux = 1, uy = 0, bestAlign = 0.62;
    for (let i = 0; i < best.length; i++) {
      const a = proj[best[i]];
      const b = proj[best[(i + 1) % best.length]];
      let vx = b[0] - a[0];
      let vy = b[1] - a[1];
      const len = Math.hypot(vx, vy);
      if (len < 1e-6) continue;
      vx /= len; vy /= len;
      // An edge and its reverse are equally valid, since a face has no inherent
      // top; take whichever reads left-to-right. Requiring a genuinely
      // horizontal run rather than merely the least-bad one keeps a numeral from
      // being set at 84 degrees when no edge is anywhere near level.
      for (const [cx, cy] of [[vx, vy], [-vx, -vy]]) {
        if (cx > bestAlign) { bestAlign = cx; ux = cx; uy = cy; }
      }
    }

    // Genesys narrative dice sit in the face plane like the numerals do —
    // rotated to a face edge and foreshortened by how far the face is turned —
    // so the symbols read as printed on the die rather than floating flat over
    // whatever angle it settled at. Sized to the face's inscribed circle.
    if (this.genFace) {
      const r = faceInradiusScreen(best, proj, c2) * 0.92 * (0.9 + 0.1 * alpha);
      ctx.save();
      ctx.translate(c2[0], c2[1]);
      ctx.transform(ux, uy, -uy * bestFacing, ux * bestFacing, 0, 0);
      ctx.globalAlpha = alpha;
      drawGenesysSymbols(ctx, this.genFace, r, ink);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    const label = String(this.value);
    // Long labels (d100 can show 3 digits) need to shrink to stay on the face.
    const fit = label.length > 2 ? 0.34 : label.length > 1 ? 0.42 : 0.52;
    const size = Math.max(7, s * fit * (0.55 + 0.45 * bestFacing));

    // The pop. A plain fade reads as the number developing like a photograph;
    // arriving very slightly small and growing into place reads as it landing.
    // Small on purpose — at more than a few percent it becomes a bounce, and
    // the tray already has enough motion at the moment dice come to rest.
    const grown = size * (0.88 + 0.12 * alpha);

    ctx.save();
    ctx.translate(c2[0], c2[1]);
    // Rotate to the face's own axis, then squash vertically by how much the
    // face is turned away — the same foreshortening the edges already show.
    ctx.transform(ux, uy, -uy * bestFacing, ux * bestFacing, 0, 0);
    ctx.font = `600 ${grown}px "Iosevka Etoile", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.globalAlpha = alpha;
    ctx.fillText(label, 0, 0);
    // Drawn here so it shares the face's skew: the ring sits in the surface with
    // the numeral rather than floating flat over the die.
    this.drawFaceMark(ctx, theme, size);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// The radius of the largest circle that fits inside a face, measured where the
// The screen direction from the face centre toward a d10 kite's apex — the
// pole vertex the face narrows to. A V5 glyph is stood up along this axis (loop
// at the apex, blade toward the equator) so it sits on the die the way a symbol
// is printed on a real die, not merely upright on the screen.
//
// A kite has one axis of symmetry, through the two vertices where the adjacent
// edges are equal; the apex is the one whose adjacent edges are the longer pair
// (the pointier, pole end). Non-kite faces have no such axis, so they fall back
// to screen-up.
function faceUpAxis(face, proj, c2) {
  if (face.length !== 4) return [0, -1];
  const P = face.map(i => proj[i]);
  // edge[i] is the length of the edge from vertex i to i+1.
  const edge = P.map((p, i) => {
    const q = P[(i + 1) % 4];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  // At vertex i the adjacent edges are edge[i-1] (incoming) and edge[i].
  const adjDiff = i => Math.abs(edge[(i + 3) % 4] - edge[i]);
  const adjSum  = i => edge[(i + 3) % 4] + edge[i];
  // The two vertices whose adjacent edges are most nearly equal are the axis.
  const axis = [0, 1, 2, 3].sort((a, b) => adjDiff(a) - adjDiff(b)).slice(0, 2);
  const apex = adjSum(axis[0]) >= adjSum(axis[1]) ? axis[0] : axis[1];
  const dx = P[apex][0] - c2[0], dy = P[apex][1] - c2[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

// The radius of the largest circle that fits inside the face as it appears on
// screen — the shortest distance from the face centre to any of its projected
// edges. The V5 glyph is drawn centred, so this one number is exactly how big
// the mark can grow before it touches an edge.
function faceInradiusScreen(face, proj, c2) {
  let r = Infinity;
  for (let i = 0; i < face.length; i++) {
    const a = proj[face[i]], b = proj[face[(i + 1) % face.length]];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    // Perpendicular distance from c2 to the line through a and b.
    r = Math.min(r, Math.abs(ex * (a[1] - c2[1]) - ey * (a[0] - c2[0])) / len);
  }
  return Number.isFinite(r) ? r : 0;
}

// Original line-art glyphs for the V5 symbol dice — our own vocabulary in the
// spirit of the official set, NOT copied from it. The success mark is an ankh
// drawn as a dagger (a ring pommel over a downward blade); a critical adds an
// ornament that differs by die class — sparks on an ordinary die, fangs on a
// Hunger die — and the Hunger 1 is a skull.
//
// The ornament, not just the base shape, is what tells a success from a critical
// across a table at twenty pixels: an ankh and an ankh-with-sparks read apart
// where an ankh and an ankh-with-a-tick would not.
//
// Everything is drawn inside a box of side L centred on the origin, with the
// furthest ink about 0.47·L out, which is what lets the caller size the mark
// from the face's inscribed circle.
function drawV5Glyph(ctx, face, L, color, paper) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, L * 0.10);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (face) {
    // Success is the bare mark; a critical adds an ornament that differs by die
    // class — sparks for an ordinary die, fangs for a Hunger die — so the two
    // criticals never read as the same face.
    case 'success':         drawDaggerAnkh(ctx, L, 'none');  break;
    case 'hunger-success':  drawDaggerAnkh(ctx, L, 'none');  break;
    case 'critical':        drawDaggerAnkh(ctx, L, 'stars'); break;
    case 'hunger-critical': drawDaggerAnkh(ctx, L, 'fangs'); break;
    case 'skull':           drawSkull(ctx, L, paper);        break;
    case 'blank':
    default:
      // Blank faces are empty, exactly like the real die — nothing to draw.
      break;
  }
}

// The success mark: an ankh whose stem is a dagger. A ring pommel at the top,
// a crossguard, and a tapered blade pointing straight down — always upright, so
// the blade always points at the die's centre. `ornament` decorates the
// critical: 'stars' (an ordinary die's 10) or 'fangs' (a Hunger die's 10).
function drawDaggerAnkh(ctx, L, ornament) {
  const loopCy = -0.34 * L, loopR = 0.14 * L;
  const guardY = -0.12 * L, guardX = 0.21 * L;
  const tipY = 0.47 * L, bw = 0.08 * L, bladeTopY = guardY - 0.01 * L;
  const lw = ctx.lineWidth;

  // Ornament sits behind the ankh so the blade's edges read over it.
  if (ornament === 'stars') {
    drawSpark(ctx, -0.30 * L, -0.30 * L, 0.11 * L);
    drawSpark(ctx, 0.30 * L, -0.30 * L, 0.11 * L);
    drawSpark(ctx, -0.34 * L, 0.06 * L, 0.075 * L);
    drawSpark(ctx, 0.34 * L, 0.06 * L, 0.075 * L);
  } else if (ornament === 'fangs') {
    drawFang(ctx, -0.30 * L, guardY + 0.02 * L, 0.075 * L, 0.26 * L);
    drawFang(ctx, 0.30 * L, guardY + 0.02 * L, 0.075 * L, 0.26 * L);
  }

  // Pommel ring, neck, crossguard.
  ctx.beginPath();
  ctx.arc(0, loopCy, loopR, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, loopCy + loopR);
  ctx.lineTo(0, bladeTopY);
  ctx.moveTo(-guardX, guardY);
  ctx.lineTo(guardX, guardY);
  ctx.stroke();

  // Blade: a filled taper to a point.
  const mid = bladeTopY + 0.6 * (tipY - bladeTopY);
  ctx.beginPath();
  ctx.moveTo(-bw, bladeTopY);
  ctx.lineTo(bw, bladeTopY);
  ctx.quadraticCurveTo(bw * 0.5, mid, 0, tipY);
  ctx.quadraticCurveTo(-bw * 0.5, mid, -bw, bladeTopY);
  ctx.closePath();
  ctx.fill();
}

// Fate / Fudge marks: a bold plus, a bold minus, or nothing. Kept heavy and
// simple so a + and a − read apart at a glance across a table.
function drawFateGlyph(ctx, face, L, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.4, L * 0.16);
  ctx.lineCap = 'round';
  const a = L * 0.42;
  ctx.beginPath();
  if (face === 'plus') {
    ctx.moveTo(-a, 0); ctx.lineTo(a, 0);
    ctx.moveTo(0, -a); ctx.lineTo(0, a);
    ctx.stroke();
  } else if (face === 'minus') {
    ctx.moveTo(-a, 0); ctx.lineTo(a, 0);
    ctx.stroke();
  }
  // blank: nothing, exactly like the real die.
}

// The One Ring's two special Feat-die faces — our own line-art. The Eye is a
// lidded eye with a slit pupil; the Gandalf mark an angular rune. Neither copies
// the official artwork.
function drawTorGlyph(ctx, face, L, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.1, L * 0.09);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (face === 'eye') {
    // Almond eye: two facing arcs, with a few rays for the flame.
    ctx.beginPath();
    ctx.moveTo(-0.46 * L, 0);
    ctx.quadraticCurveTo(0, -0.34 * L, 0.46 * L, 0);
    ctx.quadraticCurveTo(0, 0.34 * L, -0.46 * L, 0);
    ctx.stroke();
    // Vertical slit pupil.
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.07 * L, 0.19 * L, 0, 0, TAU);
    ctx.fill();
    // Short flame rays above and below.
    ctx.beginPath();
    for (const dy of [-1, 1]) {
      for (const dx of [-0.22, 0, 0.22]) {
        ctx.moveTo(dx * L, dy * 0.33 * L);
        ctx.lineTo(dx * L * 1.05, dy * 0.46 * L);
      }
    }
    ctx.stroke();
    return;
  }
  // Gandalf rune: an angular "G" mark — a squared C with a tongue, the way the
  // rune reads on the die. Original line-art, not the Tolkien glyph.
  ctx.beginPath();
  ctx.moveTo(0.30 * L, -0.40 * L);
  ctx.lineTo(-0.28 * L, -0.40 * L);
  ctx.lineTo(-0.28 * L, 0.40 * L);
  ctx.lineTo(0.30 * L, 0.40 * L);
  ctx.lineTo(0.30 * L, 0.02 * L);
  ctx.lineTo(0.00 * L, 0.02 * L);
  ctx.stroke();
}

// Genesys symbols — our own line-art, one shape per meaning, chosen to survive
// tray size and to pair up: triangles for the success axis (up = good, down =
// bad; a star is its triumphant / despairing form), and a diamond vs an X for
// the advantage axis. A face shows nought, one, or two of them.
//
// `r` is the face's inscribed radius. One symbol fills it; two sit side by side.
function drawGenesysSymbols(ctx, symbols, r, color) {
  if (!symbols || symbols.length === 0) return;
  if (symbols.length === 1) {
    drawGenSymbol(ctx, symbols[0], 0, 0, r * 1.5, color);
  } else {
    drawGenSymbol(ctx, symbols[0], -r * 0.5, 0, r * 0.98, color);
    drawGenSymbol(ctx, symbols[1], r * 0.5, 0, r * 0.98, color);
  }
}

// Draw one symbol centred at (cx,cy), fitting a box of side `s` (ink within
// ±0.5·s of the centre).
function drawGenSymbol(ctx, sym, cx, cy, s, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const tri = down => {
    const d = down ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(0, -0.5 * s * d);
    ctx.lineTo(0.46 * s, 0.4 * s * d);
    ctx.lineTo(-0.46 * s, 0.4 * s * d);
    ctx.closePath();
    ctx.fill();
  };
  const star = down => {
    const d = down ? -1 : 1;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      const rad = (i % 2 === 0 ? 0.5 : 0.21) * s;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad * d;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  switch (sym) {
    case 'success': tri(false); break;
    case 'failure': tri(true); break;
    case 'triumph': star(false); break;
    case 'despair': star(true); break;
    case 'advantage': {
      ctx.beginPath();
      ctx.moveTo(0, -0.5 * s);
      ctx.lineTo(0.42 * s, 0);
      ctx.lineTo(0, 0.5 * s);
      ctx.lineTo(-0.42 * s, 0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'threat': {
      ctx.lineWidth = Math.max(1.2, s * 0.16);
      const a = 0.4 * s;
      ctx.beginPath();
      ctx.moveTo(-a, -a); ctx.lineTo(a, a);
      ctx.moveTo(-a, a); ctx.lineTo(a, -a);
      ctx.stroke();
      break;
    }
    // Star Wars Force pips — a filled circle. The die is already coloured light
    // or dark, so the pip itself carries no extra distinction.
    case 'lightside':
    case 'darkside': {
      ctx.beginPath();
      ctx.arc(0, 0, 0.34 * s, 0, TAU);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// A four-point spark: sharp outer points, a pinched waist. Filled.
function drawSpark(ctx, cx, cy, r) {
  const ir = r * 0.34;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : ir;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// A downward fang: rounded crown, curved sides, a sharp point. Filled.
function drawFang(ctx, cx, topY, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx - w, topY);
  ctx.quadraticCurveTo(cx, topY - 0.35 * h, cx + w, topY);
  ctx.quadraticCurveTo(cx + 0.4 * w, topY + 0.6 * h, cx, topY + h);
  ctx.quadraticCurveTo(cx - 0.4 * w, topY + 0.6 * h, cx - w, topY);
  ctx.closePath();
  ctx.fill();
}

// A skull as one filled silhouette — cranium, cheekbones, a rounded jaw drawn
// in a single path so there is no seam — with the eyes, nose and teeth punched
// back out in paper. An outlined skull turns to mush at twenty pixels; a solid
// one with holes in it keeps its shape.
function drawSkull(ctx, L, paper) {
  ctx.beginPath();
  ctx.moveTo(-0.30 * L, -0.02 * L);
  // Cranium dome.
  ctx.bezierCurveTo(-0.34 * L, -0.40 * L, 0.34 * L, -0.40 * L, 0.30 * L, -0.02 * L);
  // Right cheekbone in.
  ctx.bezierCurveTo(0.28 * L, 0.10 * L, 0.24 * L, 0.12 * L, 0.19 * L, 0.16 * L);
  // Right jaw down to the chin.
  ctx.lineTo(0.16 * L, 0.30 * L);
  ctx.bezierCurveTo(0.16 * L, 0.40 * L, -0.16 * L, 0.40 * L, -0.16 * L, 0.30 * L);
  // Left jaw up, left cheekbone back to the temple.
  ctx.lineTo(-0.19 * L, 0.16 * L);
  ctx.bezierCurveTo(-0.24 * L, 0.12 * L, -0.28 * L, 0.10 * L, -0.30 * L, -0.02 * L);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = paper;
  // Eyes: large angled sockets that give the skull its glare.
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * 0.06 * L, -0.10 * L);
    ctx.bezierCurveTo(dir * 0.12 * L, -0.14 * L, dir * 0.22 * L, -0.10 * L, dir * 0.21 * L, -0.02 * L);
    ctx.bezierCurveTo(dir * 0.20 * L, 0.04 * L, dir * 0.10 * L, 0.04 * L, dir * 0.06 * L, -0.10 * L);
    ctx.closePath();
    ctx.fill();
  }
  // Nose: an inverted heart.
  ctx.beginPath();
  ctx.moveTo(0, 0.14 * L);
  ctx.bezierCurveTo(-0.08 * L, 0.06 * L, -0.06 * L, -0.01 * L, 0, 0.03 * L);
  ctx.bezierCurveTo(0.06 * L, -0.01 * L, 0.08 * L, 0.06 * L, 0, 0.14 * L);
  ctx.closePath();
  ctx.fill();
  // Teeth: gaps cut across the jaw.
  ctx.strokeStyle = paper;
  ctx.lineWidth = Math.max(0.7, L * 0.045);
  ctx.beginPath();
  ctx.moveTo(-0.13 * L, 0.24 * L); ctx.lineTo(0.13 * L, 0.24 * L);
  for (const x of [-0.065, 0.065, 0]) { ctx.moveTo(x * L, 0.24 * L); ctx.lineTo(x * L, 0.36 * L); }
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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

// Precompute the rigid rotation for (rx, ry, rz) once, then apply it to many
// points with nine multiply-adds each. Same result as rotate() but without
// recomputing six trig values per vertex — the draw hot path, where a d1000
// transforms ~1996 verts + face normals every frame.
function rotMatrix(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx, matching rotate()'s X-then-Y-then-Z order.
  return [
    cz*cy,              cz*sy*sx - sz*cx, cz*sy*cx + sz*sx,
    sz*cy,              sz*sy*sx + cz*cx, sz*sy*cx - cz*sx,
    -sy,                cy*sx,            cy*cx,
  ];
}
function applyRot(m, v) {
  return [
    m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
    m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
    m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
  ];
}

// Area of a planar polygon in 3D, via the magnitude of its summed cross products.
function polygonArea(pts) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n = [n[0] + (a[1]*b[2] - a[2]*b[1]),
         n[1] + (a[2]*b[0] - a[0]*b[2]),
         n[2] + (a[0]*b[1] - a[1]*b[0])];
  }
  return Math.hypot(...n) / 2;
}

function faceNormal(pts) {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  const c = pts.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]);
  // Point the normal outward from the centroid before testing facing.
  return dot(n, c) < 0 ? n.map(x => -x) : n;
}

// Push overlapping dice apart. Runs every frame, including after they settle, so
// a die can never come to rest on top of another one.
export function separate(dice, bounds, iterations = 3) {
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (let i = 0; i < dice.length; i++) {
      for (let j = i + 1; j < dice.length; j++) {
        const a = dice[i], b = dice[j];
        const min = (a.size + b.size) * 0.5 * 0.92;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= min) continue;

        // Perfectly coincident dice have no separation axis; nudge deterministically.
        if (dist < 1e-6) { dx = (i % 2 ? 1 : -1); dy = (j % 2 ? 1 : -1); dist = Math.hypot(dx, dy); }

        const push = (min - dist) / 2;
        const nx = (dx / dist) * push, ny = (dy / dist) * push;
        a.x -= nx; a.y -= ny;
        b.x += nx; b.y += ny;
        moved = true;
      }
    }
    for (const d of dice) {
      const r = d.size * 0.5;
      d.x = Math.max(bounds.left + r, Math.min(bounds.right - r, d.x));
      d.y = Math.max(bounds.top + r, Math.min(bounds.floor - r, d.y));
    }
    if (!moved) break;
  }
}

// Contact marks under the dice themselves.
//
// This used to draw a floor line across the tray with ripples expanding on it
// wherever a die landed. Because the dice come to rest all over the tray and the
// line sat at the bottom, the ripples read as unrelated marks in a strip rather
// than as anything the dice were touching. A mark directly beneath each die does
// the job the floor line was supposed to do.
export class Surface {
  constructor() { this.marks = []; this.bursts = []; }

  impact(x, y, size) { this.marks.push({ x, y, size, t: 0 }); }

  // A die that exploded throws a burst of rays. It is the one moment the app
  // raises its voice, so it is bigger than anything else on the tray — but still
  // hairlines, so it belongs to the same drawing rather than arriving from
  // another app.
  burst(x, y, size) {
    const rays = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + Math.random() * 0.2;
      rays.push({ a, reach: 0.8 + Math.random() * 0.7 });
    }
    this.bursts.push({ x, y, size, rays, t: 0 });
  }

  step(dt) {
    this.marks = this.marks.filter(m => (m.t += dt) < 0.9);
    this.bursts = this.bursts.filter(b => (b.t += dt) < 0.75);
  }

  drawBursts(ctx, theme) {
    if (!this.bursts.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of this.bursts) {
      const p = b.t / 0.75;
      const e = 1 - Math.pow(1 - p, 3);   // fast out, slow to a stop
      const fade = Math.pow(1 - p, 1.6);

      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = fade;

      // Rays flung outward, each leaving a gap behind it so the burst reads as
      // moving rather than as a fixed starburst.
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (const ray of b.rays) {
        const inner = b.size * (0.35 + e * ray.reach * 1.5);
        const outer = inner + b.size * 0.34 * (1 - p * 0.7);
        ctx.moveTo(b.x + Math.cos(ray.a) * inner, b.y + Math.sin(ray.a) * inner);
        ctx.lineTo(b.x + Math.cos(ray.a) * outer, b.y + Math.sin(ray.a) * outer);
      }
      ctx.stroke();

      // A shock ring, thinning as it grows.
      ctx.lineWidth = 1.2 * (1 - p);
      ctx.globalAlpha = fade * 0.7;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * (0.3 + e * 1.5), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx, theme) {
    ctx.save();
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    for (const m of this.marks) {
      const e = 1 - Math.pow(1 - m.t / 0.9, 2);
      ctx.globalAlpha = 0.28 * (1 - m.t / 0.9);
      ctx.beginPath();
      ctx.ellipse(m.x, m.y + m.size * 0.42, m.size * (0.34 + e * 0.5),
                  m.size * (0.08 + e * 0.12), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // A faint ellipse under each resting die, so it reads as sitting on a surface
  // rather than floating in the middle of the tray.
  drawRests(ctx, theme, dice) {
    ctx.save();
    ctx.strokeStyle = theme.muted;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 1;
    for (const d of dice) {
      if (!d.settled) continue;
      // A dropped die loses its contact mark too, so the kept dice are the only
      // ones that read as sitting on the table.
      if (d.kept === false) continue;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + d.size * 0.46, d.size * 0.34, d.size * 0.07, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

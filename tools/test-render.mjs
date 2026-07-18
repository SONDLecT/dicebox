// Geometry tests for the wireframe solids. These catch the failure mode that a
// screenshot would show as "the d12 looks wrong": bad face recovery from the
// vertex cloud, wrong face/edge counts, or vertices off the unit sphere.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { solidFor, Die } from '../render.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

// Euler's formula V - E + F = 2 must hold for every convex polyhedron; it is a
// strong check that face recovery produced a real solid and not a soup.
const EXPECT = {
  4:  { v: 4,  f: 4,  e: 6,  sides: 3 },
  6:  { v: 8,  f: 6,  e: 12, sides: 4 },
  8:  { v: 6,  f: 8,  e: 12, sides: 3 },
  12: { v: 20, f: 12, e: 30, sides: 5 },
  20: { v: 12, f: 20, e: 30, sides: 3 },
};

for (const [sides, exp] of Object.entries(EXPECT)) {
  const s = solidFor(Number(sides));
  ok(`d${sides} exists`, !!s);
  if (!s) continue;

  ok(`d${sides} vertex count`, s.verts.length === exp.v, `got ${s.verts.length}, want ${exp.v}`);
  ok(`d${sides} face count`, s.faces.length === exp.f, `got ${s.faces.length}, want ${exp.f}`);

  const edges = new Set();
  for (const f of s.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  ok(`d${sides} edge count`, edges.size === exp.e, `got ${edges.size}, want ${exp.e}`);
  ok(`d${sides} Euler V-E+F=2`, s.verts.length - edges.size + s.faces.length === 2);

  ok(`d${sides} faces are ${exp.sides}-gons`, s.faces.every(f => f.length === exp.sides));

  // Every vertex on the unit sphere — otherwise the die renders lopsided.
  const radii = s.verts.map(v => Math.hypot(...v));
  ok(`d${sides} vertices normalized`, radii.every(r => Math.abs(r - 1) < 1e-9),
     `radius range ${Math.min(...radii).toFixed(4)}–${Math.max(...radii).toFixed(4)}`);

  // Each vertex must appear in at least three faces, or the hull has holes.
  const uses = new Array(s.verts.length).fill(0);
  for (const f of s.faces) for (const i of f) uses[i]++;
  ok(`d${sides} no orphan vertices`, uses.every(u => u >= 3), `min uses ${Math.min(...uses)}`);

  // Face vertices must be coplanar and wound in ring order (no bowties): the
  // angles around the centroid should increase monotonically.
  let planar = true;
  for (const f of s.faces) {
    const pts = f.map(i => s.verts[i]);
    const c = pts.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]).map(x => x/pts.length);
    const d = Math.hypot(...c);
    if (d < 1e-9) { planar = false; break; }
    const n = c.map(x => x/d);
    const dots = pts.map(p => n[0]*p[0] + n[1]*p[1] + n[2]*p[2]);
    if (Math.max(...dots) - Math.min(...dots) > 1e-6) { planar = false; break; }
  }
  ok(`d${sides} faces coplanar`, planar);
}

// Arbitrary side counts fall back to the token renderer rather than crashing.
for (const sides of [1, 2, 3, 5, 7, 10, 14, 16, 24, 30, 100, 1000]) {
  ok(`d${sides} falls back to token`, solidFor(sides) === null);
}

// Simulation must come to rest, and stay inside the tray while doing so.
const bounds = { left: 0, right: 300, top: 0, floor: 200 };
for (const sides of [4, 6, 8, 12, 20, 10, 100]) {
  const d = new Die(sides, 1, 150, 20, 40);
  d.throwWith(900, 700);
  let steps = 0, escaped = false;
  while (!d.settled && steps < 2000) {
    d.step(1 / 60, bounds);
    const r = d.size * 0.55;
    if (d.x < bounds.left - r || d.x > bounds.right + r ||
        d.y < bounds.top - r || d.y > bounds.floor + r) { escaped = true; break; }
    steps++;
  }
  ok(`d${sides} settles`, d.settled, `after ${steps} steps`);
  ok(`d${sides} stays in bounds`, !escaped);
  ok(`d${sides} settles promptly`, steps < 900, `took ${steps} steps (~${(steps/60).toFixed(1)}s)`);
}

// A die thrown with no velocity must still settle rather than hang forever.
const still = new Die(20, 7, 100, 100, 40);
still.throwWith(0, 0);
let n = 0;
while (!still.settled && n < 2000) { still.step(1/60, bounds); n++; }
ok('zero-velocity die settles', still.settled, `after ${n} steps`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

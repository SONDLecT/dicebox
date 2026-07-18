// Geometry tests for the wireframe solids. These catch the failure mode that a
// screenshot would show as "the d12 looks wrong": bad face recovery from the
// vertex cloud, wrong face/edge counts, or vertices off the unit sphere.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { solidFor, Die, separate } from '../render.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

// Largest distance any face vertex sits off the plane of that face's first three
// vertices. Deriving the plane from the centroid direction instead would be
// wrong for kite faces, whose plane is not perpendicular to the centroid ray —
// that mistake reported every valid trapezohedron as broken.
function maxPlanarityError(solid) {
  let worst = 0;
  for (const f of solid.faces) {
    if (f.length < 4) continue; // triangles are planar by definition
    const p = f.map(i => solid.verts[i]);
    let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const len = Math.hypot(...n);
    if (!len) return Infinity; // degenerate: first three vertices collinear
    n = n.map(x => x / len);
    const d0 = dot(n, p[0]);
    for (let k = 3; k < p.length; k++) worst = Math.max(worst, Math.abs(dot(n, p[k]) - d0));
  }
  return worst;
}

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

  ok(`d${sides} faces coplanar`, maxPlanarityError(s) < 1e-9);
}

// Every die from d2 up gets a real tumbling solid, not a flat token.
for (const sides of [2, 3, 5, 7, 10, 14, 16, 24, 30, 100, 1000]) {
  const s = solidFor(sides);
  ok(`d${sides} has a solid`, !!s);
  if (!s) continue;
  ok(`d${sides} solid is closed`, s.faces.length >= 3 && s.verts.length >= 4);
  const radii = s.verts.map(v => Math.hypot(...v));
  ok(`d${sides} bounded`, Math.max(...radii) <= 1.5 && Math.min(...radii) > 0.1);
  const uses = new Array(s.verts.length).fill(0);
  for (const f of s.faces) for (const i of f) uses[i]++;
  ok(`d${sides} no orphan vertices`, uses.every(u => u >= 2), `min ${Math.min(...uses)}`);
}

// Every die from d2 to d120 must be a valid, well-proportioned solid.
let worstPlanar = 0, worstAspect = 0, badFaces = [];
for (let sides = 2; sides <= 120; sides++) {
  const s = solidFor(sides);
  if (!s) { badFaces.push(`d${sides}:none`); continue; }

  worstPlanar = Math.max(worstPlanar, maxPlanarityError(s));

  // Face count must match the die below the geometry cap. d2 is exempt: it's a
  // coin, whose rim segments are geometry rather than outcomes.
  if (sides > 2 && sides <= 32 && sides % 2 === 0 && s.faces.length !== sides) {
    badFaces.push(`d${sides}:${s.faces.length}`);
  }

  // Aspect ratio guards the needle bug: an unsquashed trapezohedron puts its
  // apexes 60x further out than its equator, which looks nothing like a die.
  const radii = s.verts.map(v => Math.hypot(...v));
  worstAspect = Math.max(worstAspect, Math.max(...radii) / Math.min(...radii));
}
ok('d2-d120 all faces coplanar', worstPlanar < 1e-9, `worst ${worstPlanar.toExponential(1)}`);
ok('d2-d120 face counts match', badFaces.length === 0, badFaces.slice(0, 6).join(' '));
ok('d2-d120 stay near-spherical', worstAspect < 3, `worst aspect ${worstAspect.toFixed(1)}:1`);

// A real d10 is a ten-faced trapezohedron, matching the physical die.
ok('d10 has ten faces', solidFor(10).faces.length === 10);
ok('d14 has fourteen faces', solidFor(14).faces.length === 14);
ok('d24 has twenty-four faces', solidFor(24).faces.length === 24);
ok('d30 has thirty faces', solidFor(30).faces.length === 30);
ok('d1 has no solid', solidFor(1) === null);

// d2 is a coin: two broad faces plus a rim, and visibly flatter than it is wide.
const c2 = solidFor(2);
const flat = c2.verts.filter(v => Math.abs(v[1]) > 1e-9);
const thickness = Math.max(...flat.map(v => Math.abs(v[1])));
const radius = Math.max(...c2.verts.map(v => Math.hypot(v[0], v[2])));
ok('d2 is a coin, not a sphere', thickness < radius * 0.4,
   `thickness ${thickness.toFixed(2)} vs radius ${radius.toFixed(2)}`);
ok('d2 has two broad faces', c2.faces.filter(f => f.length > 4).length === 2);

// Odd counts use a bipyramid, which has an even face count by construction —
// one face simply never comes up. It must still be a sound solid.
for (const sides of [3, 5, 7, 15, 21]) {
  const s = solidFor(sides);
  ok(`d${sides} has enough faces`, s.faces.length >= sides, `${s.faces.length} < ${sides}`);
}

// Repeated calls must return the cached instance, not rebuild the hull.
ok('solids are cached', solidFor(20) === solidFor(20));

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

// --- resting orientation ---
// A settled die must present a face to the camera. Landing pole-on or vertex-on
// reads as a spike and leaves nowhere to paint the numeral.
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

for (const sides of [4, 6, 8, 10, 12, 20, 24, 30, 100]) {
  const tray = { left: 0, right: 320, top: 0, floor: 200 };
  let worstFacing = 1;
  for (let trial = 0; trial < 25; trial++) {
    const d = new Die(sides, 1, 160, 40, 44);
    d.throwWith(600 - trial * 40, 500);
    let guard = 0;
    while (!d.settled && guard++ < 1500) d.step(1 / 60, tray);

    const pts = d.solid.verts.map(v => rotate(v, d.rot[0], d.rot[1], d.rot[2]));
    let facing = 0;
    for (const f of d.solid.faces) {
      const p = f.map(i => pts[i]);
      let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      const c = p.reduce((a, q) => [a[0]+q[0], a[1]+q[1], a[2]+q[2]], [0,0,0]);
      if (dot(n, c) < 0) n = n.map(x => -x);
      const len = Math.hypot(...n);
      if (len) facing = Math.max(facing, n[2] / len);
    }
    worstFacing = Math.min(worstFacing, facing);
  }
  // cos(50 deg) ~ 0.64: the best face is within 50 degrees of square-on.
  ok(`d${sides} settles face-up`, worstFacing > 0.64, `worst facing ${worstFacing.toFixed(2)}`);
}

// --- overlap ---
// Regression: 3d6 used to land stacked because every die launched from the same
// point. Dice must end up visibly separated and inside the tray.
function overlapCount(dice) {
  let n = 0;
  for (let i = 0; i < dice.length; i++) {
    for (let j = i + 1; j < dice.length; j++) {
      const min = (dice[i].size + dice[j].size) * 0.5 * 0.9;
      if (Math.hypot(dice[j].x - dice[i].x, dice[j].y - dice[i].y) < min) n++;
    }
  }
  return n;
}

for (const count of [2, 3, 5, 8, 12, 20]) {
  const tray = { left: 0, right: 340, top: 0, floor: 220 };
  // Worst case: every die starts stacked at the exact same point.
  const dice = Array.from({ length: count }, () => new Die(6, 3, 170, 110, 34));
  for (let f = 0; f < 400; f++) {
    for (const d of dice) d.step(1 / 60, tray);
    separate(dice, tray);
  }
  ok(`${count}d6 no overlap after settling`, overlapCount(dice) === 0,
     `${overlapCount(dice)} overlapping pairs`);
  const inside = dice.every(d =>
    d.x >= tray.left - 1 && d.x <= tray.right + 1 &&
    d.y >= tray.top - 1 && d.y <= tray.floor + 1);
  ok(`${count}d6 stays inside tray`, inside);
}

// Coincident dice must not produce NaN when there's no separation axis.
const stack = [new Die(6, 1, 100, 100, 40), new Die(6, 2, 100, 100, 40)];
separate(stack, { left: 0, right: 300, top: 0, floor: 200 });
ok('coincident dice separate cleanly',
   stack.every(d => Number.isFinite(d.x) && Number.isFinite(d.y)) &&
   Math.hypot(stack[1].x - stack[0].x, stack[1].y - stack[0].y) > 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

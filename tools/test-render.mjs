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

// --- drawing must never throw ---
// Regression: d1 had no solid and draw() called a drawToken() that had been
// removed, so it threw every frame and killed the render loop — the tray stayed
// blank until a full reload. A die that cannot be drawn must degrade quietly.
{
  const noop = () => {};
  const stubCtx = new Proxy({}, {
    get: (_t, k) => (k === 'canvas' ? { width: 300, height: 200 } : noop),
    set: () => true,
  });
  const stubTheme = { line: '#000', muted: '#999', paper: '#fff', accent: '#0a0' };
  const tray = { left: 0, right: 300, top: 0, floor: 200 };

  const broken = [];
  for (let sides = 1; sides <= 120; sides++) {
    try {
      // Settled, after a full throw.
      const a = new Die(sides, 1, 50, 50, 40);
      a.throwWith(300, 300);
      for (let i = 0; i < 400 && !a.settled; i++) a.step(1 / 60, tray);
      a.draw(stubCtx, stubTheme);

      // Mid-flight, before any resting pose is chosen.
      const b = new Die(sides, sides, 50, 50, 40);
      b.throwWith(200, 200);
      b.step(1 / 60, tray);
      b.draw(stubCtx, stubTheme);

      // Staged: on the tray with no value yet.
      const c = new Die(sides, null, 50, 50, 40);
      c.settled = true; c.settling = true; c.settleT = 1;
      c.draw(stubCtx, stubTheme);
    } catch (err) {
      broken.push(`d${sides}: ${err.message}`);
    }
  }
  ok('d1-d120 draw without throwing', broken.length === 0, broken.slice(0, 3).join('; '));
}

// d1 is a real rung on the DCC chain, so it must have geometry to draw.
ok('d1 has a solid', solidFor(1) !== null);
ok('d0 has no solid', solidFor(0) === null);
ok('negative sides rejected', solidFor(-5) === null);
ok('non-numeric sides rejected', solidFor(NaN) === null);

// --- large dice look different from each other ---
// Everything past the facet cap used to collapse onto one silhouette, so a d30,
// a d57 and a d100 were indistinguishable. The family and facet count now come
// from the number's own arithmetic: stable per die, varied across dice.
{
  const probe = [30, 41, 50, 57, 60, 66, 75, 100, 127, 200, 360, 1000];
  const shapes = new Set(probe.map(s => {
    const solid = solidFor(s);
    return `${solid.faces.length}/${solid.verts.length}`;
  }));
  ok('large dice have varied silhouettes', shapes.size >= 6,
     `only ${shapes.size} distinct among ${probe.length}`);

  // Same die, same shape every time — the variety must not be random.
  const first = solidFor(57);
  ok('shape is stable per side count', solidFor(57) === first);

  // None of them may be needles or plates; a die has to read as a solid.
  let worstAspect = 0, worstSides = 0;
  // d2 is exempt: a coin is supposed to be flat.
  for (let s = 3; s <= 1000; s++) {
    const solid = solidFor(s);
    const ys = solid.verts.map(v => v[1]);
    const radii = solid.verts.map(v => Math.hypot(v[0], v[2]));
    const aspect = (Math.max(...ys) - Math.min(...ys)) / (2 * Math.max(...radii));
    const off = Math.max(aspect, 1 / aspect);
    if (off > worstAspect) { worstAspect = off; worstSides = s; }
  }
  ok('no die is a needle or a plate', worstAspect < 2.2,
     `d${worstSides} has aspect ${worstAspect.toFixed(2)}:1`);
}

// --- exact facet counts ---
// Pointed solids run every facet to an apex, so they crowd fast: a
// trapezohedron is already unreadable by 40 faces. The banded drum has no
// convergence and stays countable past 120, which is what lets a d100 actually
// carry a hundred facets instead of pretending with twelve.
{
  let exact = 0, checked = 0;
  const off = [];
  for (let sides = 22; sides <= 120; sides++) {
    const solid = solidFor(sides, 80);
    checked++;
    if (solid.faces.length === sides) exact++;
    else off.push(`d${sides}:${solid.faces.length}`);
  }
  ok('most dice d22-d120 have a facet per side', exact / checked > 0.95,
     `${exact}/${checked} exact, off: ${off.slice(0, 5).join(' ')}`);

  ok('d100 has one hundred faces', solidFor(100, 80).faces.length === 100,
     `${solidFor(100, 80).faces.length}`);
  ok('d120 has one hundred and twenty faces', solidFor(120, 80).faces.length === 120);

  // The awkward counts that do not factor cleanly still land exactly.
  for (const sides of [26, 58, 62, 82]) {
    ok(`d${sides} still lands on ${sides} faces`,
       solidFor(sides, 80).faces.length === sides,
       `${solidFor(sides, 80).faces.length}`);
  }

  // Detail follows drawn size: a die a few pixels across cannot show 100 facets,
  // and paying for geometry nobody can resolve is what blew the frame budget.
  ok('small dice carry less detail',
     solidFor(100, 12).faces.length < solidFor(100, 80).faces.length);
}

// Every side count the custom picker offers must produce a drawable solid.
{
  let bad = null;
  for (let s = 1; s <= 1000 && !bad; s++) {
    const solid = solidFor(s);
    if (!solid) { bad = `d${s} has no solid`; break; }
    if (maxPlanarityError(solid) > 1e-9) bad = `d${s} is not planar`;
    if (solid.faces.length < 3) bad = `d${s} has ${solid.faces.length} faces`;
  }
  ok('d1-d1000 all drawable', bad === null, bad || '');
}

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

// A coin must land heads or tails, never on its rim. Scoring resting poses by
// facing angle alone let a sliver of rim outrank a broad face turned slightly
// away, and the d2 landed edge-on ~83% of the time with the numeral on its edge.
{
  const tray = { left: 0, right: 320, top: 0, floor: 200 };
  let rim = 0;
  for (let t = 0; t < 120; t++) {
    const d = new Die(2, 1, 160, 40, 44);
    d.throwWith(500 - t * 3, 500);
    let guard = 0;
    while (!d.settled && guard++ < 1500) d.step(1 / 60, tray);

    const pts = d.solid.verts.map(v => rotate(v, d.rot[0], d.rot[1], d.rot[2]));
    let bestScore = 0, bestVerts = 0;
    for (const f of d.solid.faces) {
      const p = f.map(i => pts[i]);
      let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      const c = p.reduce((a, q) => [a[0]+q[0], a[1]+q[1], a[2]+q[2]], [0,0,0]);
      if (dot(n, c) < 0) n = n.map(x => -x);
      const len = Math.hypot(...n);
      if (!len) continue;
      const facing = n[2] / len;
      if (facing <= 0) continue;
      // Same projected-area score the renderer uses to choose the numeral face.
      let area = [0, 0, 0];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        area = [area[0] + (a[1]*b[2] - a[2]*b[1]),
                area[1] + (a[2]*b[0] - a[0]*b[2]),
                area[2] + (a[0]*b[1] - a[1]*b[0])];
      }
      const score = facing * (Math.hypot(...area) / 2);
      if (score > bestScore) { bestScore = score; bestVerts = f.length; }
    }
    if (bestVerts <= 4) rim++; // rim quads, not a broad face
  }
  ok('d2 never lands on its rim', rim === 0, `${rim}/120 edge landings`);
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

// Regression: a relayout that ran mid-roll used to grid only the dice that had
// already settled. Sizing a grid for that smaller count gave those dice a much
// larger size and different slots, so they landed on top of the ones still in
// flight — a garbled pile at two sizes on the first roll of a big mixed handful,
// correct on the second once everything had settled.
{
  const tray = { left: 8, right: 352, top: 8, floor: 222 };

  const placeGrid = list => {
    const w = tray.right - tray.left, h = tray.floor - tray.top;
    const cols = Math.ceil(Math.sqrt(list.length * (w / Math.max(h, 1))));
    const cw = w / cols, ch = h / Math.ceil(list.length / cols);
    const size = Math.max(26, Math.min(96, Math.min(cw, ch) * 0.78));
    list.forEach((d, i) => {
      d.x = tray.left + cw * ((i % cols) + 0.5);
      d.y = tray.top + ch * (Math.floor(i / cols) + 0.5);
      d.size = size;
    });
  };

  // The fixed relayout: grid the whole tray, and move a die's destination rather
  // than the die itself while it is still travelling.
  const relayout = dice => {
    if (!dice.length) return;
    const snap = dice.map(d => ({ d, inFlight: !d.settled && d.homeX !== undefined, x: d.x, y: d.y }));
    placeGrid(dice);
    for (const f of snap) {
      if (!f.inFlight) continue;
      f.d.homeX = f.d.x; f.d.homeY = f.d.y;
      f.d.x = f.x; f.d.y = f.y;
    }
  };

  const countOverlaps = list => {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const min = (list[i].size + list[j].size) * 0.5 * 0.9;
        if (Math.hypot(list[j].x - list[i].x, list[j].y - list[i].y) < min) n++;
      }
    }
    return n;
  };

  // The reported roll: 5d14 + 25d16 + 5d20 + 5d24 + 15d30.
  const spec = [[14, 5], [16, 25], [20, 5], [24, 5], [30, 15]];
  let worstOverlap = 0, sizeSpreads = 0;

  for (const frames of [10, 20, 30, 40, 50, 55, 60]) {
    const dice = [];
    for (const [sides, n] of spec) {
      for (let i = 0; i < n; i++) dice.push(new Die(sides, 1, 0, 0, 40));
    }
    placeGrid(dice);
    dice.forEach((d, i) => d.spinInPlace(i / dice.length));
    for (let f = 0; f < frames; f++) {
      for (const d of dice) d.step(1 / 60, tray);
    }
    relayout(dice);

    worstOverlap = Math.max(worstOverlap, countOverlaps(dice));
    if (new Set(dice.map(d => d.size.toFixed(2))).size > 1) sizeSpreads++;
  }

  ok('relayout mid-roll leaves no overlaps', worstOverlap === 0, `${worstOverlap} pairs`);
  ok('relayout keeps every die the same size', sizeSpreads === 0, `${sizeSpreads} frames with mixed sizes`);
}

// Coincident dice must not produce NaN when there's no separation axis.
const stack = [new Die(6, 1, 100, 100, 40), new Die(6, 2, 100, 100, 40)];
separate(stack, { left: 0, right: 300, top: 0, floor: 200 });
ok('coincident dice separate cleanly',
   stack.every(d => Number.isFinite(d.x) && Number.isFinite(d.y)) &&
   Math.hypot(stack[1].x - stack[0].x, stack[1].y - stack[0].y) > 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

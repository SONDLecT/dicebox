// Geometry tests for the wireframe solids. These catch the failure mode that a
// screenshot would show as "the d12 looks wrong": bad face recovery from the
// vertex cloud, wrong face/edge counts, or vertices off the unit sphere.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { solidFor, Die, separate, beginFrame } from '../render.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const faceNormal = points => {
  const n = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
};

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

// The under-30 gap dice (d9-d29) use ChatGPT's controlled-landmark-truncation
// meshes, embedded in under30-gap.js exactly as approved. Each must keep its
// exact topology: F=sides, matching V/E from the source JSON.
{
  const exp = { 9: [9, 16], 11: [16, 25], 13: [22, 33], 15: [22, 35], 17: [13, 28], 18: [16, 32], 19: [19, 36], 21: [16, 35], 22: [20, 40], 23: [24, 45], 25: [28, 51], 26: [30, 54], 27: [32, 57], 28: [34, 60], 29: [36, 63] };
  for (const [snd, [V, E]] of Object.entries(exp)) {
    const g = solidFor(Number(snd), 80);
    const Es = g.faces.reduce((a, f) => a + f.length, 0) / 2;
    ok(`d${snd} under-30 gap keeps its approved mesh (V${V}·E${E}·F${snd})`,
       g.verts.length === V && Es === E && g.faces.length === Number(snd),
       `V${g.verts.length} E${Es} F${g.faces.length}`);
  }
  // manifold: every undirected edge in exactly 2 faces, opposite winding.
  for (const snd of [9, 17, 23, 29]) {
    const g = solidFor(snd, 80);
    const uses = new Map();
    for (const f of g.faces) for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], k = a < b ? `${a}:${b}` : `${b}:${a}`;
      uses.set(k, (uses.get(k) || 0) + 1);
    }
    ok(`d${snd} under-30 gap is a closed manifold`, [...uses.values()].every(c => c === 2));
  }
  // deterministic: repeated generation is byte-stable.
  ok('under-30 gaps are deterministic', (() => {
    const a = solidFor(19, 80), b = solidFor(19, 80);
    return JSON.stringify(a.verts) === JSON.stringify(b.verts) && JSON.stringify(a.faces) === JSON.stringify(b.faces);
  })());
}

// The approved DCC d3 is a cube with I–III repeated across opposite face pairs.
// Geometry therefore has six square landing faces even though the logical die has
// three outcomes; the value renderer remains independent of physical face count.
{
  const d3 = solidFor(3);
  ok('d3 uses a cube body', d3.verts.length === 8 && d3.faces.length === 6);
  ok('d3 cube faces are square', d3.faces.every(face => face.length === 4));
}

// The accepted d5 is the softened triangular prism from the comparison gallery.
// Its bevel polygons are visual geometry, not extra logical outcomes.
{
  const d5 = solidFor(5);
  const edges = new Set();
  for (const face of d5.faces) for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  ok('d5 uses the approved softened triangular prism topology',
     d5.verts.length === 18 && edges.size === 36 && d5.faces.length === 20,
     `V${d5.verts.length} E${edges.size} F${d5.faces.length}`);
  ok('d5 keeps exactly five logical landing faces',
     d5.landingFaces?.length === 5,
     `${d5.landingFaces?.length ?? 0}`);
  ok('d5 does not always favor its larger rectangular faces', d5.equalLandingPresentation === true);
}

// The accepted Impact!/DCC d7 is a C3v clipped sphere, not a prism. The seven
// planar caps are outcomes; the spherical triangles are only the rounded shell.
{
  const d7 = solidFor(7);
  const edges = new Set();
  for (const face of d7.faces) for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  ok('d7 uses a bounded runtime C3v clipped-sphere mesh',
     d7.faces.length < 200 && d7.verts.length < 250 && edges.size < 450,
     `V${d7.verts.length} E${edges.size} F${d7.faces.length}`);
  ok('d7 has seven landing caps and a spherical remainder',
     d7.landingFaces?.length === 7 &&
     d7.faceKinds?.filter(kind => kind === 'cap').length === 7 &&
     d7.faceKinds?.filter(kind => kind === 'sphere').length === d7.faces.length - 7);
  ok('d7 separates seven curved numeral anchors from landing caps',
     d7.valueAnchors?.length === 7 && d7.hideSmoothEdges === true);
  const anchorClearance = 0.019;
  const anchorsValid = d7.valueAnchors?.every((anchor, i) =>
    Math.abs(Math.hypot(...anchor.point) - 1) < 1e-10 &&
    Math.hypot(...anchor.point.map((x, j) => x - anchor.normal[j])) < 1e-10 &&
    dot(anchor.point, d7.landingNormals[i].map(x => -x)) > 0.95 &&
    d7.landingNormals.every(n => dot(n, anchor.point) <= d7.planeOffset - anchorClearance));
  ok('every d7 numeral anchor lies on retained curved shell with cap clearance', anchorsValid === true);
  ok('d7 precomputes immutable-style render topology',
     d7.faceNormals?.length === d7.faces.length &&
     d7.wireEdges?.length === edges.size &&
     d7.wireEdges.every(edge => edge.faces.length === 2));
  const normals = d7.landingNormals || [];
  let contacts = 0;
  for (let i = 0; i < normals.length; i++) for (let j = i + 1; j < normals.length; j++) {
    if (Math.abs(dot(normals[i], normals[j]) - 0.2101383127306031) < 1e-10) contacts++;
  }
  ok('d7 preserves the twelve-contact C3v spherical code', normals.length === 7 && contacts === 12,
     `${normals.length} normals, ${contacts} contacts`);
  const compact = solidFor(7, 20);
  const medium = solidFor(7, 30);
  ok('small d7s reduce only hidden shell detail for large-roll performance',
     compact.faces.length < d7.faces.length &&
     medium.faces.length === compact.faces.length &&
     compact.landingFaces?.length === 7,
     `compact F${compact.faces.length}, medium F${medium.faces.length}, full F${d7.faces.length}`);
}

// A real d10 is a ten-faced trapezohedron, matching the physical die.
ok('d10 has ten faces', solidFor(10).faces.length === 10);
ok('d14 has fourteen faces', solidFor(14).faces.length === 14);
{
  const d14 = solidFor(14);
  const height = Math.max(...d14.verts.map(v => Math.abs(v[1])));
  const radius = Math.max(...d14.verts.map(v => Math.hypot(v[0], v[2])));
  ok('d14 uses the approved rounder trapezohedron proportion',
     Math.abs(height / radius - 0.95) < 1e-9,
     `${(height / radius).toFixed(3)}`);
}
ok('d16 uses an octagonal bipyramid',
   solidFor(16).verts.length === 10 && solidFor(16).faces.length === 16 &&
   solidFor(16).faces.every(face => face.length === 3),
   `V${solidFor(16).verts.length} F${solidFor(16).faces.length}`);
ok('d24 has twenty-four faces', solidFor(24).faces.length === 24);
ok('d24 uses a deltoidal icositetrahedron',
   solidFor(24).verts.length === 26 && solidFor(24).faces.every(face => face.length === 4),
   `V${solidFor(24).verts.length}`);
ok('d30 has thirty faces', solidFor(30).faces.length === 30);
ok('d30 uses a rhombic triacontahedron',
   solidFor(30).verts.length === 32 && solidFor(30).faces.every(face => face.length === 4),
   `V${solidFor(30).verts.length}`);

// Every approved runtime body is a consistently wound closed shell. Rendering
// uses the winding to distinguish visible faces and to choose numeral surfaces.
{
  const bad = [];
  for (const sides of [1, 3, 5, 7, 14, 16, 24, 30]) {
    const solid = solidFor(sides), uses = new Map();
    solid.faces.forEach(face => {
      const points = face.map(i => solid.verts[i]);
      const normal = faceNormal(points);
      const center = points.reduce((sum, p) => sum.map((x, i) => x + p[i] / points.length), [0, 0, 0]);
      if (dot(normal, center) <= 1e-10) bad.push(`d${sides}: inward face`);
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!uses.has(key)) uses.set(key, []);
        uses.get(key).push(`${a}:${b}`);
      }
    });
    for (const edge of uses.values()) {
      if (edge.length !== 2 || edge[0] === edge[1]) bad.push(`d${sides}: inconsistent edge`);
    }
  }
  ok('approved solids are closed and consistently outward-wound', bad.length === 0,
     [...new Set(bad)].join(', '));
}

// d1 is the approved obliquely terminated circular cylinder: a diagonal-axis
// infinite cylinder clipped by two perpendicular planes, giving two congruent
// planar end caps (the two landing faces) and 12 lateral quads. Both caps
// return 1, and the caps are the only legal result surfaces.
{
  const d1 = solidFor(1, 80);
  const edges = new Map();
  d1.faces.forEach(face => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      edges.set(a < b ? `${a}:${b}` : `${b}:${a}`, (edges.get(a < b ? `${a}:${b}` : `${b}:${a}`) || 0) + 1);
    }
  });
  ok('d1 is the oblique cylinder: 24 verts, 36 edges, 14 faces',
     d1.verts.length === 24 && edges.size === 36 && d1.faces.length === 14,
     `V${d1.verts.length} E${edges.size} F${d1.faces.length}`);
  ok('d1 has exactly two planar end caps as its landing faces',
     d1.landingFaces?.length === 2, `landing ${d1.landingFaces?.length}`);
  ok('d1 caps are dodecagons and laterals are 12 quads',
     d1.faces[0].length === 12 && d1.faces[1].length === 12 &&
     d1.faces.slice(2).length === 12 && d1.faces.slice(2).every(f => f.length === 4));
  const capPlanes = d1.landingFaces.map(fi => {
    const n = faceNormal(d1.faces[fi].map(i => d1.verts[i]));
    return n.map(x => x / Math.hypot(...n));
  });
  // cap at the z=-a cut (dominant z), cap at the x=-a cut (dominant x).
  ok('d1 caps are perpendicular planar cuts',
     Math.abs(capPlanes[0][2]) > 0.9 && Math.abs(capPlanes[1][0]) > 0.9,
     capPlanes.map(p => p.map(x => x.toFixed(2)).join(',')).join(' | '));
  ok('d1 has only cap/lateral faces (no rim-notch approach)',
     d1.faces.every(f => f.length === 12 || f.length === 4));

  // The approved d1 must always settle on an end cap (one of the two landing
  // faces), never balanced on a lateral quad, so the `1` reads on a cap.
  const rotate3 = (v, [rx, ry, rz]) => {
    let [x, y, z] = v;
    let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  };
  let capUpFail = 0;
  for (let r = 0; r < 25; r++) {
    const die = new Die(1, 1, 0, 0, 80);
    const rot = die.findFaceUpRotation();
    const solid = die.solid;
    const isUp = solid.landingFaces.some(fi => {
      const n = faceNormal(solid.faces[fi].map(i => solid.verts[i]));
      return rotate3(n, rot)[2] > 0;
    });
    if (!isUp) capUpFail++;
  }
  ok('d1 always settles with an end cap facing up', capUpFail === 0, `${capUpFail} failures / 25 throws`);
}

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

// The d7's hundreds of shell triangles approximate curvature and must not appear
// as a geodesic grid. Its numeral is engraved on an upper curved region rather
// than centered on a nonexistent parallel opposing cap.
{
  const calls = { lineTo: 0, translations: [] };
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 300, height: 200 };
      if (k === 'lineTo') return () => { calls.lineTo++; };
      if (k === 'translate') return (x, y) => { calls.translations.push([x, y]); };
      return noop;
    },
    set: () => true,
  });
  const d7 = new Die(7, 4, 0, 0, 96);
  d7.rot = [0, 0, 0];
  d7.settled = true;
  d7.numeralIn = 1;
  d7.draw(ctx, { line: '#000', muted: '#999', paper: '#fff', accent: '#0a0' });
  ok('d7 hides internal spherical tessellation edges', calls.lineTo < 300,
     `${calls.lineTo} line segments`);
  const labelAt = calls.translations[1] || [0, 0];
  ok('d7 numeral sits on a curved antipodal region, not a cap centre',
     Math.hypot(...labelAt) > 12,
     `label at ${labelAt.map(v => v.toFixed(1)).join(',')}`);
}

// d1 is a real rung on the DCC chain, so it must have geometry to draw.
ok('d1 has a solid', solidFor(1) !== null);
ok('d0 has no solid', solidFor(0) === null);
ok('negative sides rejected', solidFor(-5) === null);
ok('non-numeric sides rejected', solidFor(NaN) === null);

// --- a die shows the number of facets it is supposed to have ---
//
// The point of the shape is the count. A d47 that draws 47 facets is telling
// the truth about itself; a barrel of roughly that density is not, however
// varied the barrels are. Faceted spheres give an exact count for any number,
// which no factorisation of a drum could.
{
  let wrong = [];
  for (let sides = 23; sides <= 120; sides++) {
    const faces = solidFor(sides, 96).faces.length;
    if (faces !== sides) wrong.push(`d${sides}:${faces}`);
  }
  ok('every die from d23 to d120 has exactly its own facet count',
     wrong.length === 0, wrong.slice(0, 6).join(' '));
}

// --- past the budget, detail climbs and then stops ---
//
// A die with more facets than the eye can separate has nothing more to show, so
// above the budget every die draws the densest sphere that still reads as a
// solid. They converge, and that is the intended answer rather than a collapse:
// the earlier failure was hundreds of dice sharing three *barrels* while
// pretending to differ, not dice honestly showing the same maximum.
{
  const at = n => solidFor(n, 96).faces.length;
  ok('detail still climbs just past the budget', at(121) < at(140) && at(140) < at(150),
     `${at(121)} / ${at(140)} / ${at(150)}`);
  ok('detail stops at the budget', at(150) === 120 && at(1000) === 120,
     `${at(150)} / ${at(1000)}`);
  // The budget is a real ceiling, which it was not: at 60 facets, 937 of 1000
  // dice used to exceed it, some by a third.
  for (const [size, budget] of [[96, 120], [48, 60], [30, 36]]) {
    let over = 0, worst = 0;
    for (let sides = 23; sides <= 1000; sides++) {
      const f = solidFor(sides, size).faces.length;
      if (f > budget) { over++; worst = Math.max(worst, f); }
    }
    ok(`the ${budget}-facet budget holds`, over === 0, `${over} over, worst ${worst}`);
  }
}

// --- the facets are evenly sized ---
//
// What makes a many-sided die read as one is that its faces are all about the
// same size and none of them line up in rows. A Fibonacci spiral gives both;
// the drum this replaced gave neither, and its remainder wedges could be four
// times the area of their neighbours.
{
  const areaOf = (s, f) => {
    let a = 0;
    for (let i = 1; i < f.length - 1; i++) {
      const p0 = s.verts[f[0]], p1 = s.verts[f[i]], p2 = s.verts[f[i + 1]];
      const u = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
      const v = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
      a += 0.5 * Math.hypot(
        u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]);
    }
    return a;
  };

  let worst = 0, worstDie = 0;
  // under-30 gap dice (d9-d29) are deliberately non-uniform truncation shapes
  // (controlled-landmark-truncation), so they're exempt from this evenness rule,
  // which describes faceted-sphere dice above the cap.
  const GAP = new Set([9, 11, 13, 15, 17, 18, 19, 21, 22, 23, 25, 26, 27, 28, 29]);
  for (let sides = 23; sides <= 120; sides++) {
    if (GAP.has(sides)) continue;
    const s = solidFor(sides, 96);
    const areas = s.faces.map(f => areaOf(s, f));
    const spread = Math.max(...areas) / Math.min(...areas);
    if (spread > worst) { worst = spread; worstDie = sides; }
  }
  ok('no facet is much larger than any other', worst < 1.5,
     `worst ${worst.toFixed(2)}x at d${worstDie}`);
}

// --- a shape is stable, and reads as a solid ---
{
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

// --- the numeral appears only once there is a face to put it on ---
//
// The glyph rides whichever facet points at the camera, so painting it through
// a tumble made the number look undecided when it had in fact been decided
// before the die moved. It is hidden while the die turns fast and fades in as
// it slows onto a readable face.
//
// Driven through step() at 60fps rather than by setting the flags directly.
// The first attempt at this keyed the fade on `settling`, which the flag-poking
// tests happily confirmed while the real animation never showed a numeral at
// all: a thrown die does not reach `settling` for nearly three seconds.
{
  const BOUNDS = { left: 8, right: 352, top: 8, floor: 222 };
  const DT = 1 / 60;

  // Runs a die through frames, recording alpha, until `done` or the cap.
  const run = (d, frames = 400, done = () => false) => {
    const alphas = [];
    let settledAt = null;
    for (let f = 0; f < frames; f++) {
      beginFrame();
      d.step(DT, BOUNDS);
      alphas.push(d.numeralAlpha());
      if (settledAt === null && d.settled) settledAt = f;
      if (done(d, f)) break;
    }
    return {
      alphas,
      settledAt,
      firstVisible: alphas.findIndex(a => a > 0),
      fullAt: alphas.findIndex(a => a >= 1),
      ms: f => Math.round(f * DT * 1000),
    };
  };

  const thrown = () => {
    const d = new Die(20, 17, 20, 30, 40);
    d.homeX = 180; d.homeY = 120;
    d.throwWith((d.homeX - d.x) * 2.4, (d.homeY - d.y) * 2.4);
    return d;
  };

  {
    const d = thrown();
    ok('a die shows no numeral the instant it is thrown', d.numeralAlpha() === 0);

    const r = run(d);
    ok('a thrown die eventually shows its numeral', r.fullAt !== -1);
    ok('the numeral is hidden through the fast part of the tumble',
       r.firstVisible > 20, `appeared at frame ${r.firstVisible}`);

    // The die has to actually stop in a reasonable time, because the numeral
    // now rides the settle. It once took 2.9s — not because it was still
    // turning, but because the settle condition also waited for the die to stop
    // drifting toward its slot at under 8px/s, which happens long after it has
    // visibly stopped. Decoupling the two is what makes the fade land while
    // anyone is still watching.
    ok('the die settles while the roll is still happening',
       r.settledAt !== null && r.ms(r.settledAt) <= 2000,
       r.settledAt === null ? 'never settled' : `${r.ms(r.settledAt)}ms`);

    let dips = 0;
    for (let i = 1; i < r.alphas.length; i++) {
      if (r.alphas[i] < r.alphas[i - 1] - 1e-9) dips++;
    }
    ok('the numeral never dims once it has begun', dips === 0, `${dips} dips`);
  }

  {
    // Spin-in-place dice are the exception the rule has to carry: their spin
    // never decays, so there is no slowing to detect and the fade rides the
    // settle instead. Keyed on angular speed alone they would stay blank.
    const d = new Die(20, 17, 100, 100, 40);
    d.spinInPlace(0);
    const r = run(d, 200);
    ok('a spin-in-place die shows its numeral too', r.fullAt !== -1);
    ok('a spin-in-place die is blank while it holds its spin', r.firstVisible > 2,
       `appeared at frame ${r.firstVisible}`);
    ok('a spin-in-place numeral arrives promptly',
       r.fullAt !== -1 && r.ms(r.fullAt) <= 1000, `${r.ms(r.fullAt)}ms`);
  }

  {
    // A reroll lands, pauses so the first number can be read, then hops and
    // tumbles again. The numeral has to leave with the hop — watching the old
    // number go away is the entire point of animating a reroll.
    const d = new Die(6, 4, 100, 100, 40);
    d.spinInPlace(0);
    // Runs past the settle rather than stopping on it: the numeral is advanced
    // at the top of step from the previous frame's motion, so the frame that
    // first reports `settled` is one short of a finished fade.
    run(d, 300);
    ok('a landed die is showing its numeral before the reroll', d.numeralAlpha() === 1);

    d.beginReroll();
    // Long enough to exhaust rerollPause, which is what triggers the hop.
    d.step(0.5, BOUNDS);
    ok('the numeral leaves when a rerolled die hops',
       d.numeralAlpha() === 0,
       `alpha=${d.numeralAlpha()} settled=${d.settled} settling=${d.settling}`);

    const again = run(d, 400);
    ok('a rerolled die shows its new numeral after landing again', again.fullAt !== -1);
  }

  {
    // A roll is a fixed piece of choreography and must take the same time
    // whatever the page is managing to render.
    //
    // It did not. Damping was applied once per frame while the rotation it
    // damps was integrated per second, so a slow page rolled for longer in
    // wall-clock terms: 1.9s at 60fps against 3.0s at 30. That turned out to be
    // what "the dice roll for half as long in the Owlbear panel" was — the
    // panel's canvas is a quarter of the desktop tray's area and reaches frame
    // rates the desktop one does not.
    const atRate = fps => {
      const dt = Math.min(0.05, 1 / fps);
      const times = [];
      for (let i = 0; i < 40; i++) {
        const d = thrown();
        let f = 0;
        for (; f < 3000; f++) {
          beginFrame();
          d.step(dt, BOUNDS);
          if (d.numeralAlpha() >= 1) break;
        }
        times.push(f * dt * 1000);
      }
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)];
    };

    const rates = [120, 60, 30, 20].map(fps => ({ fps, ms: atRate(fps) }));
    const fastest = Math.min(...rates.map(r => r.ms));
    const slowest = Math.max(...rates.map(r => r.ms));
    ok('a roll takes the same time at any frame rate',
       slowest - fastest <= 250,
       rates.map(r => `${r.fps}fps:${Math.round(r.ms)}ms`).join(' '));
  }

  {
    // Measured over a population rather than one die. Each throw seeds its own
    // random spin, so a single sample swings by hundreds of milliseconds and an
    // assertion on one is a coin flip — which is how the first version of this
    // test failed about half the time it ran.
    const times = [];
    for (let i = 0; i < 80; i++) {
      const r = run(thrown(), 240, (d, f) => d.numeralAlpha() >= 1 && f > 0);
      if (r.fullAt !== -1) times.push(r.ms(r.fullAt));
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)];
    const worst = times[times.length - 1];

    ok('every die in a handful shows its numeral', times.length === 80, `${times.length}/80`);

    // Bounds, not targets. They exist to catch the numeral drifting back toward
    // the formal settle at ~2.9s, which is what the first implementation did and
    // what made it invisible in practice. Tightening these means changing the
    // spin decay — see the table in IDEAS.md under "Tried and reverted".
    ok('the numeral is in before the die stops moving', p50 <= 1700, `p50 ${p50}ms`);
    ok('no die keeps its numeral hidden for two seconds', worst <= 2000, `worst ${worst}ms`);

    // Dice light up at different moments because each was thrown differently,
    // but the spread has to read as one roll settling rather than as numbers
    // loading in one at a time.
    //
    // Measured p10 to p90 rather than min to max. The extremes of 80 samples
    // are themselves the noisiest thing here — asserting on them made this fail
    // about one run in three on a bound the implementation comfortably meets.
    const p10 = times[Math.floor(times.length * 0.1)];
    const p90 = times[Math.floor(times.length * 0.9)];
    ok('the handful lights up within a readable window of itself',
       p90 - p10 <= 800, `${p90 - p10}ms across the middle 80%`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

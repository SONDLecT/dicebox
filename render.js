// Wireframe die rendering + throw simulation.
//
// Dice are drawn as pure line work: no fill, no shadow. Depth comes only from
// drawing back-facing edges at reduced opacity. The "table" is one hairline rule.

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
function bipyramid(n) {
  const H = 1.15;
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

// d1 is the shape people actually print for a one-sided die: a short cylinder
// with two wedges cut out of it, so whichever way it rolls it topples onto the
// same flat face. Every other rest position is unstable by construction.
//
// A Möbius strip was tried first — one surface, one edge, cute — but it reads as
// hatching at die size, and a real d1 is the better joke: an object whose whole
// design is that it cannot land any other way.
function oneSided(segments = 32) {
  const verts = [];
  const half = 0.42;

  // Two notches taken out of the rim. They have to be narrow enough that the
  // cylinder still reads as round — cutting deep leaves a flat slab, which
  // looks like a domino rather than a die that cannot help landing face up.
  const gap = 0.07;   // fraction of the circle removed per wedge
  const kept = [];
  for (let i = 0; i < segments; i++) {
    const f = i / segments;
    const inWedge = (f > 0.25 - gap && f < 0.25 + gap) || (f > 0.75 - gap && f < 0.75 + gap);
    if (inWedge) continue;
    kept.push(f);
  }

  const top = [], bottom = [];
  for (const f of kept) {
    const a = f * TAU;
    top.push(verts.push([Math.cos(a), half, Math.sin(a)]) - 1);
    bottom.push(verts.push([Math.cos(a), -half, Math.sin(a)]) - 1);
  }

  const faces = [];
  // The face it always lands on, and its opposite.
  faces.push(top.slice());
  faces.push(bottom.slice().reverse());

  // Rim panels between consecutive kept segments. Where a wedge was cut the
  // panel spans the gap, which is the flat that makes the die tip over.
  for (let i = 0; i < kept.length; i++) {
    const j = (i + 1) % kept.length;
    faces.push([top[i], top[j], bottom[j], bottom[i]]);
  }
  return normalize({ verts, faces });
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
  return { verts: solid.verts.map(v => v.map(x => x / scale)), faces: solid.faces };
}

const SOLIDS = { 4: tetra, 6: cube, 8: octa, 12: dodeca, 20: icosa };

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
  const key = `${sides}:${budget}`;
  if (solidCache.has(key)) return solidCache.get(key);

  let solid;
  if (sides === 1) {
    solid = oneSided();
  } else if (sides === 2) {
    solid = coin();
  } else if (SOLIDS[sides]) {
    solid = SOLIDS[sides]();
  } else if (sides <= POINTED_LIMIT) {
    // Few enough facets that a pointed solid still reads: exactly one face per
    // side, in the shape a physical die of that size actually takes.
    solid = sides % 2 === 0 && sides / 2 >= 3
      ? trapezohedron(sides / 2)
      : prismBarrel(sides);
  } else if (sides <= budget) {
    // Exactly one facet per side, spread evenly over a sphere.
    solid = facetedSphere(sides);
  } else {
    // More facets than can be told apart at this size, so the die shows as
    // many as it can carry. A d1000 drawn honestly would be a circle; drawn
    // like this it is the densest sphere that still reads as a solid.
    // Detail still climbs with the die until the budget stops it, so a d130
    // carries visibly more than a d121 and everything past about d150 shows the
    // same maximum. That last part is not a limitation to work around: a die
    // with more facets than the eye can separate has no more to show.
    solid = facetedSphere(Math.min(budget, Math.round(sides * 0.8)))
  }

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
      const pts = this.solid.verts.map(v => rotate(v, cand[0], cand[1], cand[2]));

      // Score by projected screen area, not facing angle alone. Facing alone
      // lets a sliver of rim beat a broad face that is only slightly turned —
      // which is why the coin landed on its edge nearly every flip.
      let visible = 0;
      for (const face of this.solid.faces) {
        const fp = face.map(i2 => pts[i2]);
        const n = faceNormal(fp);
        const len = Math.hypot(...n);
        if (!len) continue;
        const facing = n[2] / len;
        if (facing <= 0) continue;
        visible = Math.max(visible, facing * polygonArea(fp) * facing);
      }
      // Prefer a big square-on face, but stay near the pose it actually landed in.
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

    const [rx, ry, rz] = this.rot;
    const pts = this.solid.verts.map(v => rotate(v, rx, ry, rz));
    const proj = pts.map(p => {
      const d = 4 / (4 - p[2]);
      return [p[0] * s * d, p[1] * s * d, p[2]];
    });

    // Back edges first, faint; front edges over them at full strength.
    const edges = new Map();
    for (const face of this.solid.faces) {
      const n = faceNormal(face.map(i => pts[i]));
      const front = n[2] > 0;
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i+1) % face.length];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) || false) || front);
      }
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const pass of [false, true]) {
      ctx.beginPath();
      for (const [key, front] of edges) {
        if (front !== pass) continue;
        const [a, b] = key.split(':').map(Number);
        ctx.moveTo(proj[a][0], proj[a][1]);
        ctx.lineTo(proj[b][0], proj[b][1]);
      }
      ctx.strokeStyle = theme.line;
      // Scaled rather than set, so a dropped die's fade survives this pass.
      ctx.globalAlpha = fade * (pass ? 1 : 0.22);
      ctx.lineWidth = pass ? 1.6 : 1.1;
      ctx.stroke();
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

    // Pick the face by visible screen area, matching findFaceUpRotation. Going
    // by facing angle alone paints the numeral on whatever sliver happens to
    // point at the camera — on a coin, that meant a digit on the rim.
    let best = null, bestFacing = 0, bestScore = 0;
    for (const face of this.solid.faces) {
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

    // A staged die has no value yet: it is waiting on the tray to be thrown, so
    // it shows as an empty shape rather than a number it does not have.
    if (this.value === null || this.value === undefined) return;
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
    ctx.fillStyle = theme.line;
    ctx.globalAlpha = alpha;
    ctx.fillText(label, 0, 0);
    // Drawn here so it shares the face's skew: the ring sits in the surface with
    // the numeral rather than floating flat over the die.
    this.drawFaceMark(ctx, theme, size);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
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

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

// Antiprism: two rings offset by half a step, joined by a band of triangles and
// closed with a shallow pyramid at each end. Reads as a straight-sided drum
// rather than the cones a trapezohedron gives.
//
// The ends are pyramids rather than flat n-gon caps on purpose. A flat cap is
// many times the area of a band triangle, and the resting-orientation search
// scores by visible area — so a capped antiprism landed on one of its two lids
// almost every roll, which looked like the die had only two outcomes.
function antiprism(n) {
  const verts = [];
  const half = 0.52;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    verts.push([Math.cos(a), half, Math.sin(a)]);
  }
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * TAU;
    verts.push([Math.cos(a), -half, Math.sin(a)]);
  }
  const apexTop = verts.push([0, half + 0.40, 0]) - 1;
  const apexBot = verts.push([0, -half - 0.40, 0]) - 1;

  const top = i => i % n;
  const bot = i => n + (i % n);
  const faces = [];
  for (let i = 0; i < n; i++) {
    faces.push([top(i), top(i + 1), bot(i)]);
    faces.push([bot(i), top(i + 1), bot(i + 1)]);
    faces.push([apexTop, top(i + 1), top(i)]);
    faces.push([apexBot, bot(i), bot(i + 1)]);
  }
  return normalize({ verts, faces });
}

// A squat trapezohedron. Same construction as the tall one — the planar apex
// height is not negotiable — but flattened harder, which reads as a ball of
// facets rather than a pair of cones.
//
// (An actual rhombic solid was tried here and cut: pulling one ring inward to
// turn the kites into rhombi makes every face non-planar, the same way guessing
// the apex height did.)
// `flatten` scales the pole height directly, so smaller values are squatter —
// 1.0 puts the poles level with the equator, giving a ball of facets rather
// than the pair of cones a larger value produces.
function squat(n) {
  return trapezohedron(n, 0.85);
}

// Elongated bipyramid: a prism band with a pyramid on each end. Reads as a
// crystal rather than a drum or a pair of cones.
function elongated(n) {
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
  const apexTop = verts.push([0, half + 0.42, 0]) - 1;
  const apexBot = verts.push([0, -half - 0.42, 0]) - 1;

  const faces = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n + j, n + i]);
    faces.push([apexTop, j, i]);
    faces.push([apexBot, n + i, n + j]);
  }
  return normalize({ verts, faces });
}

// Banded drum: rings of quads stacked up a sphere, closed with a small cap at
// each pole. This is the family that scales — vertices spread evenly over the
// surface instead of converging on two apexes, so a drum stays countable at 120
// faces where a trapezohedron is an unreadable blob by 40.
//
// That is what makes a legible d100 possible: not fewer facets, but facets that
// do not all run to a point.
function drum(around, bands, profile = 1) {
  const verts = [];
  const rows = [];

  // `profile` shapes the silhouette so drums of similar density stay tellable
  // apart: below 1 it barrels outward, above 1 it pinches toward the poles.
  for (let k = 0; k <= bands; k++) {
    const y = 0.62 - (1.24 * k) / bands;
    const r = Math.pow(Math.max(0.05, 1 - (y * 1.05) ** 2), 0.5 * profile);
    const row = [];
    for (let i = 0; i < around; i++) {
      const a = (i / around) * TAU;
      row.push(verts.push([Math.cos(a) * r, y, Math.sin(a) * r]) - 1);
    }
    rows.push(row);
  }

  const apexTop = verts.push([0, 0.86, 0]) - 1;
  const apexBot = verts.push([0, -0.86, 0]) - 1;

  // Rings are aligned rather than staggered, and the band faces are trapezoids
  // whose four corners share a plane. Staggering the rows looked more like a
  // real many-sided die but made every quad non-planar, and the front/back edge
  // test then misclassified edges — which drew as holes in the mesh.
  const faces = [];
  for (let k = 0; k < bands; k++) {
    for (let i = 0; i < around; i++) {
      const j = (i + 1) % around;
      faces.push([rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]]);
    }
  }
  for (let i = 0; i < around; i++) {
    const j = (i + 1) % around;
    faces.push([apexTop, rows[0][j], rows[0][i]]);
    faces.push([apexBot, rows[bands][i], rows[bands][j]]);
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

// Every die gets a real, fair solid — no flat tokens.
//
//   - Coin for d2, since no two-faced polyhedron exists
//   - Platonic solids where one exists (d4, d6, d8, d12, d20)
//   - Trapezohedron for even counts: 2n kite faces. This is how physical d10s
//     are made, and it extends to d14, d16, d24, d30 and beyond.
//   - Prism barrel for odd counts: n numbered faces around the equator with a
//     pointed cap at each pole. This is how physical d5s and d7s are made, and
//     it gives an exact face count for any n — a d17 gets seventeen faces, not
//     an eighteen-faced solid pretending.
//
// Every face of a given solid is equivalent under its rotational symmetry, so
// the shape is honest about the die. (The roll itself is decided by crypto RNG
// regardless; this is about the geometry not lying.)
// Families used for dice too large to draw facet-per-face. Each produces a
// clearly different silhouette: cones, a drum, a crystal, a rhombic ball.
const LARGE_FAMILIES = [
  n => trapezohedron(n, 1.45), // rounded cones
  antiprism,                   // straight-sided drum
  elongated,                   // faceted crystal
  squat,                       // ball of facets
];

// Choose the shape from the number's own arithmetic, so it is stable across
// rolls but varies across dice. The smallest prime factor picks the family and
// the digit sum nudges the facet count, which spreads neighbours like d100 and
// d102 apart instead of collapsing them onto one shape.
// A drum with exactly `total` faces. Faces are around*bands quads plus 2*around
// cap triangles, so total = around * (bands + 2). Picking the divisor pair
// closest to square keeps rings and columns similar in size, which reads better
// than a few tall bands or one very fine ring.
function drumWithFaces(total) {
  // Silhouette varies with the die so two drums of similar density do not read
  // as the same object: below 1 barrels outward, above 1 pinches toward the poles.
  const profile = 0.62 + ((total % 7) / 6) * 0.76;

  // total = around * bands + 2 * around, so any divisor of `total` that leaves
  // a workable ring count gives an exact face count. Prefer the split closest to
  // square: a few tall bands or one very fine ring both read worse.
  let best = null;
  for (let bands = 1; bands <= 10; bands++) {
    const around = total / (bands + 2);
    if (!Number.isInteger(around) || around < 5 || around > 30) continue;
    const squareness = Math.abs(Math.log(around / (bands + 2)));
    if (!best || squareness < best.squareness) best = { around, bands, squareness };
  }
  if (best) return drum(best.around, best.bands, profile);

  // No clean factorisation — 26 and 58 are the awkward cases. Rather than accept
  // a wrong face count, take the exact ring count and put the remainder in a
  // single ring of extra facets at one pole.
  return drumWithRemainder(total, profile);
}

// Exact face count when `total` does not factor: build the largest drum that
// fits, then split one cap's triangles to make up the difference.
function drumWithRemainder(total, profile) {
  let around = 0, bands = 0;
  for (let a = 30; a >= 5; a--) {
    for (let b = 1; b <= 10; b++) {
      const faces = a * (b + 2);
      if (faces <= total && faces > around * (bands + 2)) { around = a; bands = b; }
    }
  }
  const base = drum(around, bands, profile);
  const shortfall = total - around * (bands + 2);
  if (shortfall <= 0) return base;

  // Split that many cap triangles in two by adding a midpoint on their outer
  // edge. Each split adds exactly one face and keeps every face planar, since a
  // triangle's parts are triangles.
  const verts = base.verts.map(v => v.slice());
  const faces = base.faces.map(f => f.slice());
  for (let n = 0; n < shortfall; n++) {
    const idx = faces.findIndex(f => f.length === 3);
    if (idx === -1) break;
    const [apex, a, b] = faces[idx];
    const mid = verts.push([
      (verts[a][0] + verts[b][0]) / 2,
      (verts[a][1] + verts[b][1]) / 2,
      (verts[a][2] + verts[b][2]) / 2,
    ]) - 1;
    faces.splice(idx, 1, [apex, a, mid], [apex, mid, b]);
  }
  return { verts, faces };
}

function largeSolid(sides, budget = MAX_FACETS) {
  let smallestFactor = sides;
  for (let f = 2; f * f <= sides; f++) {
    if (sides % f === 0) { smallestFactor = f; break; }
  }
  const digitSum = String(sides).split('').reduce((a, c) => a + Number(c), 0);

  // Past what the pointed families can carry, only the drum stays countable, so
  // high dice all use it and take their variety from proportions instead. A d100
  // then reads as genuinely many-sided rather than as a twelve-sided fake.
  if (sides > POINTED_LIMIT) {
    const target = Math.min(budget, Math.round(sides * 0.8));
    // Rounder dice get more rings; the digit sum varies the ring/column split so
    // neighbours differ without either dimension getting too fine to read.
    const bands = 2 + (digitSum % 3);
    const around = Math.max(6, Math.min(22, Math.round(target / (bands + 1))));
    return drum(around, bands);
  }

  const family = LARGE_FAMILIES[(smallestFactor + digitSum) % LARGE_FAMILIES.length];

  // Facets grow with the die so a d70 visibly carries more than a d41, while
  // the digit sum keeps neighbours from collapsing onto one shape.
  const fromSize = Math.round(Math.sqrt(sides) * 1.5);
  const facets = Math.max(6, Math.min(Math.floor(budget / 2), fromSize + (digitSum % 4)));
  return family(facets);
}

// Detail is capped by how large the die is actually drawn, not just by its side
// count. A die 12px across cannot show 80 facets — the edges land closer than a
// pixel apart — and paying for geometry nobody can resolve is what pushed a
// hundred-dice roll past the frame budget. Big single rolls keep full detail.
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
    // d1 is a real rung on the DCC chain, so it has to render. A rounded token
    // is the honest shape: there is no one-faced polyhedron, and every throw
    // shows the same face anyway.
    solid = trapezohedron(6);
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
    // Still one face per side, but as a drum — a pointed solid with this many
    // facets converges into an unreadable blob, while a drum stays countable.
    solid = drumWithFaces(sides);
  } else {
    // Too many faces to draw one per side, so the shape becomes representative:
    // a family and a facet count derived from the number itself, so a d70 still
    // carries visibly more detail than a d41 and each die keeps one shape.
    solid = largeSolid(sides, budget);
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
  }

  throwWith(vx, vy) {
    this.vx = vx; this.vy = vy;
    const speed = Math.hypot(vx, vy);
    this.spin = [
      (Math.random()-0.5) * 0.02 * speed + 0.15,
      (Math.random()-0.5) * 0.02 * speed + 0.15,
      (Math.random()-0.5) * 0.02 * speed,
    ];
    this.settling = false;
    this.settled = false;
    this.targetRot = null; // recomputed for wherever this throw lands
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
    this.spinHold = 0.16 + delay * 0.42;
  }

  step(dt, bounds) {
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
      this.vx *= 0.94;
      this.vy *= 0.94;

      const r = this.size * 0.55;
      if (this.x < bounds.left + r) { this.x = bounds.left + r; this.vx = Math.abs(this.vx) * 0.55; }
      if (this.x > bounds.right - r) { this.x = bounds.right - r; this.vx = -Math.abs(this.vx) * 0.55; }
      if (this.y < bounds.top + r) { this.y = bounds.top + r; this.vy = Math.abs(this.vy) * 0.55; }
      if (this.y > bounds.floor - r) { this.y = bounds.floor - r; this.vy = -Math.abs(this.vy) * 0.55; }

      for (let i = 0; i < 3; i++) {
        this.rot[i] += this.spin[i] * dt * 60;
        this.spin[i] *= 0.965;
      }

      // Ease toward the slot the layout assigned, so dice spread out instead of
      // landing wherever momentum happens to leave them.
      if (this.homeX !== undefined) {
        this.vx += (this.homeX - this.x) * 3.2 * dt;
        this.vy += (this.homeY - this.y) * 3.2 * dt;
      }

      if (Math.hypot(this.vx, this.vy) < 8 && Math.abs(this.spin[0]) < 0.02) {
        this.settling = true;
        this.settleT = 0;
        this.restRot = this.rot.slice();
      }
    } else {
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
    this.drawMarks(ctx, theme, s);
    ctx.restore();
  }

  // What happened to this die, in the same hairline vocabulary as the dice: a
  // burst for an exploded die, a cycle for a rerolled one. Small enough to
  // ignore, present enough to answer "why is this d6 showing 14".
  drawMarks(ctx, theme, s) {
    if (!this.settled) return;
    const marks = [];
    if (this.exploded) marks.push('burst');
    if (this.rerolled) marks.push('cycle');
    if (!marks.length) return;

    const r = s * 0.2;
    marks.forEach((mark, i) => {
      const x = s * 0.72;
      const y = -s * 0.72 + i * r * 2.4;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';

      if (mark === 'burst') {
        // Six short rays: the die kept going past its maximum.
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          ctx.moveTo(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
      } else {
        // An open circle with a tick: it came round again.
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.72, 0.5, TAU - 0.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(r * 0.62, -r * 0.52);
        ctx.lineTo(r * 0.72, -r * 0.05);
        ctx.lineTo(r * 0.2, -r * 0.16);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  // Paint the numeral onto the face that most directly faces the camera, using
  // that face's own plane. The glyph is skewed to sit in the surface rather than
  // floating flat over the shape, so it tracks the die as it tumbles.
  drawValue(ctx, theme, s, pts, proj) {
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
    let ux = 1, uy = 0, bestAlign = -Infinity;
    for (const i of best) {
      let vx = proj[i][0] - c2[0];
      let vy = proj[i][1] - c2[1];
      const len = Math.hypot(vx, vy);
      if (len < 1e-6) continue;
      vx /= len; vy /= len;
      // A face has no inherent top, so a direction and its opposite are equally
      // valid; take whichever reads left-to-right.
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

    ctx.save();
    ctx.translate(c2[0], c2[1]);
    // Rotate to the face's own axis, then squash vertically by how much the
    // face is turned away — the same foreshortening the edges already show.
    ctx.transform(ux, uy, -uy * bestFacing, ux * bestFacing, 0, 0);
    ctx.font = `600 ${size}px "Iosevka Etoile", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.line;
    ctx.globalAlpha = this.settled ? 1 : 0.35 + 0.65 * bestFacing;
    ctx.fillText(label, 0, 0);
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
  constructor() { this.marks = []; }

  impact(x, y, size) { this.marks.push({ x, y, size, t: 0 }); }

  step(dt) {
    this.marks = this.marks.filter(m => (m.t += dt) < 0.9);
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
